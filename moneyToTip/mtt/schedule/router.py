"""schedule 接口：拉取到期题（R-api-01）、回写作答（R-api-02）。"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from mtt.corpus.models import Category, Question
from mtt.corpus.service import to_dict
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule.memory import MemoryDecision, MemorySnapshot, Rating, decide, preview
from mtt.schedule.models import Plan, QuestionState, ReviewLog
from mtt.timeutil import utcnow

router = APIRouter(prefix="/reviews", tags=["schedule"])

# 内部状态码 → 界面用户语言（术语黑名单，R-session-06；§15.4）
STATUS_LABELS = {
    "new": "新学",
    "learning": "学习中",
    "review": "稳定复习",
    "relearning": "重学中",
}


def _descendant_category_ids(session: Session, user: User, root_id: int) -> set[int]:
    """root_id 及其全部后代分类 id：选「面试」即包含「面试::Java::并发」的题。"""
    cats = session.exec(select(Category).where(Category.owner_id == user.id)).all()
    children: dict[int | None, list[int]] = {}
    for c in cats:
        children.setdefault(c.parent_id, []).append(c.id)
    ids = {root_id}
    stack = [root_id]
    while stack:
        for cid in children.get(stack.pop(), []):
            if cid not in ids:
                ids.add(cid)
                stack.append(cid)
    return ids


class ReviewSubmit(BaseModel):
    question_id: int
    client_id: str  # 幂等键：重发同一结果两次，日志仍只有一条（R-api-10）
    correct: bool
    rating: Rating = "good"
    duration_ms: int = Field(default=0, ge=0)
    plan_id: int | None = None


@router.get("/due")
def due_questions(limit: int = Query(default=20, ge=1, le=100),
                  category_id: int | None = None,
                  bank_id: int | None = None,
                  user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> list[dict]:
    """按分钟返回到期题，新题在已到期题之后补足队列容量。"""
    now = utcnow()
    category_filter = None
    if category_id is not None:
        root = session.get(Category, category_id)
        if root is None or root.owner_id != user.id:
            raise HTTPException(404, "category not found")
        category_filter = _descendant_category_ids(session, user, category_id)

    stmt = (
        select(Question, QuestionState)
        .outerjoin(QuestionState, and_(
            QuestionState.question_id == Question.id,
            QuestionState.user_id == user.id,
        ))
        .where(
            Question.owner_id == user.id,
            Question.status == "active",
            or_(QuestionState.due_at <= now, QuestionState.id.is_(None)),
        )
    )
    if category_filter is not None:
        stmt = stmt.where(Question.category_id.in_(category_filter))
    if bank_id is not None:
        stmt = stmt.where(Question.bank_id == bank_id)
    results = session.exec(
        stmt.order_by(QuestionState.id.is_(None), QuestionState.due_at.asc(), Question.id.asc())
        .limit(limit)
    ).all()

    out = []
    for question, state in results:
        item = to_dict(question)
        status = state.status if state else "new"
        label = ("已掌握" if state and status == "review" and
                 state.interval_minutes >= 21 * 1440 else STATUS_LABELS[status])
        item["state"] = {
            "status": status,
            "label": label,
            "due_at": _as_utc(state.due_at) if state else None,
        }
        snapshot = MemorySnapshot(
            reps=state.reps if state else 0,
            lapses=state.lapses if state else 0,
            stability_days=state.stability_days if state else 1.0,
            interval_minutes=state.interval_minutes if state else 0,
        )
        item["rating_previews"] = preview(snapshot, now)
        out.append(item)
    return out


def _validate_plan(session: Session, user: User, question: Question,
                   plan_id: int | None) -> None:
    if plan_id is None:
        return
    plan = session.get(Plan, plan_id)
    if plan is None or plan.owner_id != user.id:
        raise HTTPException(404, "plan not found")
    if plan.bank_id is not None and question.bank_id != plan.bank_id:
        raise HTTPException(409, "question is outside the plan bank")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _decision_dict(decision: MemoryDecision) -> dict:
    return {
        "interval_minutes": decision.interval_minutes,
        "due_at": decision.due_at,
        "algorithm_version": decision.algorithm_version,
    }


def _decision_from_log(log: ReviewLog) -> dict:
    return {
        "interval_minutes": log.decision_interval_minutes,
        "due_at": _as_utc(log.decision_due_at),
        "algorithm_version": log.decision_algorithm_version,
    }


def _replay_response(session: Session, log: ReviewLog, payload: ReviewSubmit,
                     user: User) -> dict:
    if log.user_id != user.id or log.question_id != payload.question_id:
        raise HTTPException(409, "client_id is already used by another review")
    state = session.exec(select(QuestionState).where(
        QuestionState.user_id == log.user_id,
        QuestionState.question_id == log.question_id,
    )).first()
    return {
        "log_id": log.id,
        "idempotent": True,
        "state": None if state is None else {
            "status": state.status,
            "label": STATUS_LABELS[state.status],
            "due_at": _as_utc(state.due_at),
        },
        "decision": _decision_from_log(log),
    }


@router.post("", status_code=201)
def submit_review(payload: ReviewSubmit, user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> dict:
    question = session.get(Question, payload.question_id)
    if question is None or question.owner_id != user.id:
        raise HTTPException(404, "question not found")

    existing = session.exec(
        select(ReviewLog).where(ReviewLog.client_id == payload.client_id)
    ).first()
    if existing is not None:
        return _replay_response(session, existing, payload, user)

    _validate_plan(session, user, question, payload.plan_id)
    state = session.exec(select(QuestionState).where(
        QuestionState.user_id == user.id,
        QuestionState.question_id == payload.question_id,
    )).first()
    snapshot = MemorySnapshot(
        reps=state.reps if state else 0,
        lapses=state.lapses if state else 0,
        stability_days=state.stability_days if state else 1.0,
        interval_minutes=state.interval_minutes if state else 0,
    )
    now = utcnow()
    rating = payload.rating if payload.correct else "again"
    decision = decide(snapshot, rating, now)
    if state is None:
        state = QuestionState(user_id=user.id, question_id=payload.question_id)
    state.stability_days = decision.stability_days
    state.interval_minutes = decision.interval_minutes
    state.due_at = decision.due_at
    state.status = decision.status
    state.algorithm_version = decision.algorithm_version
    state.reps += 1
    state.lapses += 1 if rating == "again" else 0
    state.last_rating = rating
    state.last_reviewed_at = now

    log = ReviewLog(
        user_id=user.id,
        question_id=question.id,
        client_id=payload.client_id,
        correct=payload.correct,
        rating=payload.rating,
        duration_ms=payload.duration_ms,
        plan_id=payload.plan_id,
        reviewed_at=now,
        decision_due_at=decision.due_at,
        decision_interval_minutes=decision.interval_minutes,
        decision_algorithm_version=decision.algorithm_version,
    )
    session.add(state)
    session.add(log)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.exec(
            select(ReviewLog).where(ReviewLog.client_id == payload.client_id)
        ).first()
        if existing is None:
            raise
        return _replay_response(session, existing, payload, user)
    return {
        "log_id": log.id,
        "idempotent": False,
        "state": {
            "status": state.status,
            "label": STATUS_LABELS[state.status],
            "due_at": _as_utc(state.due_at),
        },
        "decision": _decision_dict(decision),
    }
