"""schedule 接口：拉取到期题（R-api-01）、回写作答（R-api-02）。"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from mtt.corpus.models import Category, Question
from mtt.corpus.service import to_dict
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule import engine
from mtt.schedule.models import QuestionState, ReviewLog

router = APIRouter(prefix="/reviews", tags=["schedule"])

# 内部状态码 → 界面用户语言（术语黑名单，R-session-06；§15.4）
STATUS_LABELS = {"new": "新学", "learning": "巩固中", "mastered": "已掌握"}


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
    rating: str = "good"     # again | hard | good | easy
    duration_ms: int = 0


@router.get("/due")
def due_questions(limit: int = 20, category_id: int | None = None,
                  bank_id: int | None = None,
                  user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> list[dict]:
    """只出现"已到期"的题，不硬塞题（R-schedule-07）。

    已复习过的题按 QuestionState.due_date；从未复习过的 active 新题视为今天到期。
    category_id 含全部后代分类；bank_id 精确匹配题库。筛选只是队列开关，不是前置门槛。
    """
    today = date.today()
    category_filter = None
    if category_id is not None:
        root = session.get(Category, category_id)
        if root is None or root.owner_id != user.id:
            raise HTTPException(404, "category not found")
        category_filter = _descendant_category_ids(session, user, category_id)

    stmt = (
        select(QuestionState, Question)
        .join(Question, Question.id == QuestionState.question_id)
        .where(
            QuestionState.user_id == user.id,
            QuestionState.due_date <= today,
            Question.status == "active",  # pending/flagged/suspended 不进复习队列
        )
    )
    if category_filter is not None:
        stmt = stmt.where(Question.category_id.in_(category_filter))
    if bank_id is not None:
        stmt = stmt.where(Question.bank_id == bank_id)
    results = list(session.exec(stmt.limit(limit)).all())

    # 没有复习状态的 active 新题：今天到期
    if len(results) < limit:
        reviewed_ids = {q.id for _, q in results}
        stmt = select(Question).where(
            Question.owner_id == user.id, Question.status == "active")
        if category_filter is not None:
            stmt = stmt.where(Question.category_id.in_(category_filter))
        if bank_id is not None:
            stmt = stmt.where(Question.bank_id == bank_id)
        for q in session.exec(stmt.limit(limit * 10)).all():
            if len(results) >= limit:
                break
            if q.id in reviewed_ids:
                continue
            state = session.exec(
                select(QuestionState).where(
                    QuestionState.user_id == user.id,
                    QuestionState.question_id == q.id,
                )
            ).first()
            if state is None:
                results.append((None, q))

    out = []
    for state, question in results:
        item = to_dict(question)
        status = state.status if state else "new"
        item["state"] = {
            "status": status,
            "label": STATUS_LABELS[status],
        }
        out.append(item)
    return out


@router.post("", status_code=201)
def submit_review(payload: ReviewSubmit, user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> dict:
    question = session.get(Question, payload.question_id)
    if question is None or question.owner_id != user.id:
        raise HTTPException(404, "question not found")

    # 幂等：同一 client_id 重复提交直接返回已有记录（R-api-10）
    stmt = select(ReviewLog).where(ReviewLog.client_id == payload.client_id)
    existing = session.exec(stmt).first()
    if existing is not None:
        return {"log_id": existing.id, "idempotent": True}

    rating = "again" if not payload.correct else payload.rating

    log = ReviewLog(
        user_id=user.id, question_id=payload.question_id,
        client_id=payload.client_id, correct=payload.correct,
        rating=rating, duration_ms=payload.duration_ms,
    )
    session.add(log)

    stmt = select(QuestionState).where(
        QuestionState.user_id == user.id,
        QuestionState.question_id == payload.question_id,
    )
    state = session.exec(stmt).first()
    if state is None:
        state = QuestionState(user_id=user.id, question_id=payload.question_id)
    interval, status, due = engine.apply_review(state.interval_days, rating)
    state.interval_days, state.status, state.due_date = interval, status, due
    state.reps += 1
    session.add(state)

    session.commit()
    return {
        "log_id": log.id,
        "idempotent": False,
        "state": {"status": state.status, "label": STATUS_LABELS[state.status]},
    }
