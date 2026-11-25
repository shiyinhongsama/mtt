"""可解释的真实复习日志聚合，不参与排期决策。"""

from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import case
from sqlmodel import Session, func, select

from mtt.corpus.models import Category, Question
from mtt.schedule.models import QuestionState, ReviewLog
from mtt.timeutil import local_day_start_utc


def memory_insights(session: Session, user_id: int, days: int, now: datetime) -> dict:
    since = local_day_start_utc(-days + 1)
    valid = (ReviewLog.user_id == user_id, ReviewLog.is_help_request == False,  # noqa: E712
             ReviewLog.reviewed_at >= since, ReviewLog.reviewed_at <= now)
    recalled = session.exec(select(func.count()).select_from(ReviewLog).where(
        *valid, ReviewLog.rating != "again")).one()
    total = session.exec(select(func.count()).select_from(ReviewLog).where(*valid)).one()
    retention = {"recalled": recalled, "total": total,
                 "rate": round(recalled / total, 4) if total >= 20 else None}

    logs = session.exec(select(ReviewLog.question_id, ReviewLog.rating).where(*valid).order_by(
        ReviewLog.question_id, ReviewLog.reviewed_at, ReviewLog.id)).all()
    failed: set[int] = set()
    recovered: set[int] = set()
    for question_id, rating in logs:
        if rating == "again":
            failed.add(question_id)
            recovered.discard(question_id)
        elif rating in ("good", "easy") and question_id in failed:
            recovered.add(question_id)

    learning_count = session.exec(select(func.count()).select_from(QuestionState).where(
        QuestionState.user_id == user_id, QuestionState.status == "learning")).one()
    review_count = session.exec(select(func.count()).select_from(QuestionState).where(
        QuestionState.user_id == user_id, QuestionState.status == "review")).one()

    day_start = local_day_start_utc()
    end = local_day_start_utc(7)
    due_states = session.exec(select(QuestionState.due_at).where(
        QuestionState.user_id == user_id, QuestionState.due_at < end)).all()
    forecast_counts = {(day_start + timedelta(days=offset)).date().isoformat(): 0
                       for offset in range(7)}
    for due_at in due_states:
        key = max(due_at.astimezone().date(), day_start.date()).isoformat()
        if key in forecast_counts:
            forecast_counts[key] += 1

    category_rows = session.exec(
        select(Question.category_id, func.count(ReviewLog.id),
               func.sum(case((ReviewLog.rating != "again", 1), else_=0)))
        .select_from(ReviewLog).join(Question, Question.id == ReviewLog.question_id)
        .where(*valid).group_by(Question.category_id)).all()
    due_rows = session.exec(select(Question.category_id, func.count()).select_from(QuestionState)
        .join(Question, Question.id == QuestionState.question_id).where(
        QuestionState.user_id == user_id, QuestionState.due_at <= now,
        Question.status == "active").group_by(Question.category_id)).all()
    due_counts = {category_id: count for category_id, count in due_rows}
    category_ids = {category_id for category_id, _, _ in category_rows if category_id is not None}
    names = {category.id: category.name for category in session.exec(
        select(Category).where(Category.owner_id == user_id, Category.id.in_(category_ids))
    ).all()} if category_ids else {}
    weak_categories = []
    for category_id, sample_total, sample_recalled in category_rows:
        sample_recalled = sample_recalled or 0
        rate = sample_recalled / sample_total
        if rate >= 0.85:
            continue
        weak_categories.append({
            "category_id": category_id, "name": names.get(category_id, "未分类"),
            "recalled": sample_recalled, "total": sample_total, "rate": round(rate, 4),
            "due_count": due_counts.get(category_id, 0),
        })
    weak_categories.sort(key=lambda item: (item["rate"], -item["total"]))

    return {"retention": retention,
            "learning_count": learning_count, "review_count": review_count,
            "recovered_count": len(recovered),
            "forecast": [{"date": key, "count": count} for key, count in forecast_counts.items()],
            "weak_categories": weak_categories}
