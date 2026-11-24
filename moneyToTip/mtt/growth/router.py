"""growth 接口：北极星指标、热力图（R-growth-03）、分类掌握度（R-growth-04 前置）。"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from mtt.corpus.models import Category, Question, QuestionBank
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule.models import QuestionState, ReviewLog
from mtt.timeutil import local_day_start_utc

router = APIRouter(prefix="/stats", tags=["growth"])


@router.get("")
def stats(user: User = Depends(get_current_user),
          session: Session = Depends(get_session)) -> dict:
    today = date.today()

    mature = session.exec(
        select(func.count())
        .select_from(QuestionState)
        .where(QuestionState.user_id == user.id, QuestionState.status == "mastered")
    ).one()

    due_states = session.exec(
        select(func.count())
        .select_from(QuestionState)
        .where(QuestionState.user_id == user.id, QuestionState.due_date <= today)
    ).one()
    # 从未复习过的 active 新题视为今天到期（与 /reviews/due 口径一致）
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
        "mature_count": mature,            # 成熟知识量（北极星）
        "due_today": due_today,            # 今日待复习
        "reviewed_today": reviewed_today,  # 今日已答
        "active_questions": active_questions,
        "status_counts": {s: n for s, n in status_rows},
        "by_bank": _by_bank(session, user, today),
        "heatmap": _heatmap(session, user, today),
        "by_category": _by_category(session, user, today),
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
        key = ts.astimezone().date().isoformat()  # 本地日期
        counts[key] = counts.get(key, 0) + 1
    return [{"date": str(today - timedelta(days=i)),
             "count": counts.get(str(today - timedelta(days=i)), 0)}
            for i in range(29, -1, -1)]


def _by_bank(session: Session, user: User, today: date) -> list[dict]:
    """每个题库：在库题目数 / 已掌握 / 今日待复习。"""
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
    mature = group(QuestionState.status == "mastered")
    due = group(QuestionState.due_date <= today)

    # 从未复习的新题计入今日待复习（与 due_today 口径一致）
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


def _by_category(session: Session, user: User, today: date) -> list[dict]:
    """每个分类的直接题目数 / 已掌握 / 今日待复习；未分类单独一桶。"""
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
        .where(QuestionState.user_id == user.id, QuestionState.status == "mastered",
               Question.status == "active")
        .group_by(Question.category_id)).all())

    due = bucket_rows(session.exec(
        select(Question.category_id, func.count())
        .select_from(QuestionState)
        .join(Question, Question.id == QuestionState.question_id)
        .where(QuestionState.user_id == user.id, QuestionState.due_date <= today,
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
    # 未复习过的新题也算今日待复习（与 due_today 口径一致）
    new_due = session.exec(
        select(Question.category_id, func.count())
        .where(Question.owner_id == user.id, Question.status == "active",
               Question.id.not_in(  # noqa: E711
                   select(QuestionState.question_id).where(QuestionState.user_id == user.id)))
        .group_by(Question.category_id)).all()
    for item in out:
        item["due"] += dict(new_due).get(item["category_id"], 0)
    return out
