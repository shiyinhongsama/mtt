"""growth 接口：北极星指标、热力图（R-growth-03）、分类掌握度（R-growth-04 前置）。"""

from datetime import date, datetime, timedelta
from statistics import median

from fastapi import APIRouter, Depends
from sqlalchemy import and_, or_
from sqlmodel import Session, func, select

from mtt.corpus.models import Category, Question, QuestionBank
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule.models import Plan, QuestionState, ReviewLog
from mtt.schedule.plans import get_active_plan_ids
from mtt.timeutil import local_day_start_utc, local_midnight_as_utc, utcnow

router = APIRouter(prefix="/stats", tags=["growth"])


@router.get("/today")
def today_stats(user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    now = utcnow()
    day_start = local_day_start_utc()
    plan_ids = get_active_plan_ids(session, user)
    plans = session.exec(select(Plan).where(
        Plan.owner_id == user.id, Plan.id.in_(plan_ids))).all() if plan_ids else []
    all_banks = not plans or any(plan.bank_id is None for plan in plans)
    bank_ids = [plan.bank_id for plan in plans if plan.bank_id is not None]

    def scope(query):
        query = query.where(Question.owner_id == user.id, Question.status == "active")
        return query if all_banks else query.where(Question.bank_id.in_(bank_ids))

    question_scope = scope(select(Question.id))
    new_count = session.exec(scope(select(func.count()).select_from(Question).where(
        Question.id.not_in(select(QuestionState.question_id).where(QuestionState.user_id == user.id))
    ))).one()
    due_count = session.exec(scope(select(func.count()).select_from(QuestionState).join(
        Question, Question.id == QuestionState.question_id).where(
        QuestionState.user_id == user.id, QuestionState.due_at <= now))).one() + new_count
    relearning_count = session.exec(scope(select(func.count()).select_from(QuestionState).join(
        Question, Question.id == QuestionState.question_id).where(
        QuestionState.user_id == user.id, QuestionState.status == "relearning"))).one()

    completed_query = select(func.count(func.distinct(ReviewLog.question_id))).select_from(
        ReviewLog).join(Question, Question.id == ReviewLog.question_id).where(
        ReviewLog.user_id == user.id, ReviewLog.is_help_request == False,  # noqa: E712
        ReviewLog.reviewed_at >= day_start)
    if plans:
        legacy = ReviewLog.plan_id.is_(None)
        if not all_banks:
            legacy = and_(legacy, Question.bank_id.in_(bank_ids))
        completed_query = completed_query.where(or_(ReviewLog.plan_id.in_(plan_ids), legacy))
    completed_count = session.exec(completed_query).one()
    goal_count = sum(plan.daily_goal for plan in plans)
    goal_met = completed_count >= goal_count if goal_count else due_count == 0
    shortage = (not goal_met and goal_count > 0 and completed_count + due_count < goal_count)

    durations = session.exec(select(ReviewLog.duration_ms).where(
        ReviewLog.user_id == user.id, ReviewLog.is_help_request == False,  # noqa: E712
        ReviewLog.duration_ms > 0)).all()
    estimated_minutes = median(durations) / 60_000 if len(durations) >= 5 else None

    future_states = session.exec(scope(select(QuestionState.due_at).select_from(QuestionState).join(
        Question, Question.id == QuestionState.question_id).where(
        QuestionState.user_id == user.id, QuestionState.due_at < local_day_start_utc(7)))).all()
    forecast_counts = {(day_start + timedelta(days=offset)).date().isoformat(): 0
                       for offset in range(7)}
    for due_at in future_states:
        local_day = due_at.astimezone().date()
        key = max(local_day, day_start.astimezone().date()).isoformat()
        if key in forecast_counts:
            forecast_counts[key] += 1
    today_key = day_start.date().isoformat()
    forecast_counts[today_key] += new_count

    return {
        "due_count": due_count, "new_count": new_count,
        "relearning_count": relearning_count, "completed_count": completed_count,
        "goal_count": goal_count, "goal_met": goal_met,
        "shortage_reason": "not_enough_due_questions" if shortage else None,
        "estimated_minutes": estimated_minutes,
        "forecast": [{"date": key, "count": count} for key, count in forecast_counts.items()],
    }


def _is_mature():
    return ((QuestionState.status == "review") &
            (QuestionState.interval_minutes >= 21 * 1440))


@router.get("")
def stats(user: User = Depends(get_current_user),
          session: Session = Depends(get_session)) -> dict:
    today = date.today()
    now = utcnow()

    mature = session.exec(
        select(func.count())
        .select_from(QuestionState)
        .where(QuestionState.user_id == user.id, _is_mature())
    ).one()

    due_states = session.exec(
        select(func.count())
        .select_from(QuestionState)
        .where(QuestionState.user_id == user.id, QuestionState.due_at <= now)
    ).one()
    # 从未复习过的 active 新题视为现在到期（与 /reviews/due 口径一致）
    new_active = session.exec(
        select(func.count()).select_from(Question)
        .where(Question.owner_id == user.id, Question.status == "active",
               Question.id.not_in(  # noqa: E711
                   select(QuestionState.question_id).where(QuestionState.user_id == user.id)))
    ).one()
    due_today = due_states + new_active

    day_start = local_day_start_utc()
    reviewed_today = session.exec(
        select(func.count())
        .select_from(ReviewLog)
        .where(ReviewLog.user_id == user.id,
               ReviewLog.is_help_request == False,  # noqa: E712
               ReviewLog.reviewed_at >= day_start)
    ).one()

    active_questions = session.exec(
        select(func.count())
        .select_from(Question)
        .where(Question.owner_id == user.id, Question.status == "active")
    ).one()

    status_rows = session.exec(
        select(Question.status, func.count())
        .where(Question.owner_id == user.id)
        .group_by(Question.status)
    ).all()

    return {
        "mature_count": mature,
        "due_today": due_today,
        "reviewed_today": reviewed_today,
        "active_questions": active_questions,
        "status_counts": {s: n for s, n in status_rows},
        "by_bank": _by_bank(session, user, now),
        "heatmap": _heatmap(session, user, today),
        "by_category": _by_category(session, user, now),
    }


def _heatmap(session: Session, user: User, today: date) -> list[dict]:
    """近 30 天每日答题数（按本地日期分桶），热力图用（R-growth-03：时间线呈现，不做连续打卡惩罚）。"""
    since = local_day_start_utc(-29)
    stamps = session.exec(
        select(ReviewLog.reviewed_at)
        .where(ReviewLog.user_id == user.id,
               ReviewLog.is_help_request == False,  # noqa: E712
               ReviewLog.reviewed_at >= since)
    ).all()
    counts: dict[str, int] = {}
    for ts in stamps:
        key = ts.astimezone().date().isoformat()
        counts[key] = counts.get(key, 0) + 1
    return [{"date": str(today - timedelta(days=i)),
             "count": counts.get(str(today - timedelta(days=i)), 0)}
            for i in range(29, -1, -1)]


def _by_bank(session: Session, user: User, now: datetime) -> list[dict]:
    """每个题库：在库题目数 / 已掌握 / 当前待复习。"""
    banks = {b.id: b.name for b in
             session.exec(select(QuestionBank).where(QuestionBank.owner_id == user.id)).all()}

    def group(col_filter=None) -> dict[int | None, int]:
        stmt = (select(Question.bank_id, func.count())
                .select_from(QuestionState)
                .join(Question, Question.id == QuestionState.question_id)
                .where(QuestionState.user_id == user.id, Question.status == "active"))
        if col_filter is not None:
            stmt = stmt.where(col_filter)
        return {bid: n for bid, n in
                session.exec(stmt.group_by(Question.bank_id)).all()}

    total = {bid: n for bid, n in session.exec(
        select(Question.bank_id, func.count())
        .where(Question.owner_id == user.id, Question.status == "active")
        .group_by(Question.bank_id)).all()}
    mature = group(_is_mature())
    due = group(QuestionState.due_at <= now)

    new_due = {bid: n for bid, n in session.exec(
        select(Question.bank_id, func.count())
        .where(Question.owner_id == user.id, Question.status == "active",
               Question.id.not_in(  # noqa: E711
                   select(QuestionState.question_id).where(QuestionState.user_id == user.id)))
        .group_by(Question.bank_id)).all()}

    out = []
    for bid in sorted(set(total) | set(mature) | set(due)):
        out.append({
            "bank_id": bid,
            "name": banks.get(bid) or f"题库#{bid}",
            "total": total.get(bid, 0),
            "mature": mature.get(bid, 0),
            "due": due.get(bid, 0) + new_due.get(bid, 0),
        })
    return out


def _by_category(session: Session, user: User, now: datetime) -> list[dict]:
    """每个分类的直接题目数 / 已掌握 / 当前待复习；未分类单独一桶。"""
    cat_names = {c.id: c.name for c in
                 session.exec(select(Category).where(Category.owner_id == user.id)).all()}

    def bucket_rows(rows) -> dict[int | None, int]:
        return {cid: n for cid, n in rows}

    total = bucket_rows(session.exec(
        select(Question.category_id, func.count())
        .where(Question.owner_id == user.id, Question.status == "active")
        .group_by(Question.category_id)).all())

    mature = bucket_rows(session.exec(
        select(Question.category_id, func.count())
        .select_from(QuestionState)
        .join(Question, Question.id == QuestionState.question_id)
        .where(QuestionState.user_id == user.id, _is_mature(), Question.status == "active")
        .group_by(Question.category_id)).all())

    due = bucket_rows(session.exec(
        select(Question.category_id, func.count())
        .select_from(QuestionState)
        .join(Question, Question.id == QuestionState.question_id)
        .where(QuestionState.user_id == user.id, QuestionState.due_at <= now,
               Question.status == "active")
        .group_by(Question.category_id)).all())

    ids = sorted(set(total) | set(mature) | set(due), key=lambda x: (x is None, x))
    out = []
    for cid in ids:
        out.append({
            "category_id": cid,
            "name": cat_names.get(cid) if cid is not None else "未分类",
            "total": total.get(cid, 0),
            "mature": mature.get(cid, 0),
            "due": due.get(cid, 0),
        })
    new_due = session.exec(
        select(Question.category_id, func.count())
        .where(Question.owner_id == user.id, Question.status == "active",
               Question.id.not_in(  # noqa: E711
                   select(QuestionState.question_id).where(QuestionState.user_id == user.id)))
        .group_by(Question.category_id)).all()
    for item in out:
        item["due"] += dict(new_due).get(item["category_id"], 0)
    return out
