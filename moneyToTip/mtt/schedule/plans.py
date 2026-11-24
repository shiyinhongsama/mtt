"""训练计划接口：每日目标 + 加练（百词斩式玩法，§16.2 一等公民）。"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from mtt.corpus.models import Question, QuestionBank
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule.models import Plan, ReviewLog
from mtt.timeutil import local_day_start_utc

router = APIRouter(prefix="/plans", tags=["schedule"])


class PlanCreate(BaseModel):
    name: str
    bank_id: int | None = None  # 空 = 全部题库
    daily_goal: int = Field(default=10, ge=1, le=200)


def _plan_progress(session: Session, user: User, plan: Plan) -> int:
    """今日已在计划范围内答了多少题（不含 AI 求助）。
    "今日"按本地时区 0 点起算，换算 UTC 后与库中时间串比较。"""
    day_start = local_day_start_utc()
    stmt = (select(func.count())
            .select_from(ReviewLog)
            .join(Question, Question.id == ReviewLog.question_id)
            .where(ReviewLog.user_id == user.id,
                   ReviewLog.is_help_request == False,  # noqa: E712
                   ReviewLog.reviewed_at >= day_start))
    if plan.bank_id is not None:
        stmt = stmt.where(Question.bank_id == plan.bank_id)
    return session.exec(stmt).one()


def _plan_dict(session: Session, user: User, plan: Plan) -> dict:
    done = _plan_progress(session, user, plan)
    return {"id": plan.id, "name": plan.name, "bank_id": plan.bank_id,
            "daily_goal": plan.daily_goal, "today_done": done,
            "goal_met": done >= plan.daily_goal,
            "created_at": plan.created_at}


@router.get("")
def list_plans(user: User = Depends(get_current_user),
               session: Session = Depends(get_session)) -> list[dict]:
    stmt = select(Plan).where(Plan.owner_id == user.id).order_by(Plan.id)
    return [_plan_dict(session, user, p) for p in session.exec(stmt).all()]


@router.post("", status_code=201)
def create_plan(payload: PlanCreate, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    if payload.bank_id is not None:
        bank = session.get(QuestionBank, payload.bank_id)
        if bank is None or bank.owner_id != user.id:
            raise HTTPException(404, "bank not found")
    plan = Plan(owner_id=user.id, name=payload.name,
                bank_id=payload.bank_id, daily_goal=payload.daily_goal)
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return _plan_dict(session, user, plan)


@router.patch("/{plan_id}")
def update_plan(plan_id: int, payload: PlanCreate,
                user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    plan = session.get(Plan, plan_id)
    if plan is None or plan.owner_id != user.id:
        raise HTTPException(404, "plan not found")
    if payload.bank_id is not None:
        bank = session.get(QuestionBank, payload.bank_id)
        if bank is None or bank.owner_id != user.id:
            raise HTTPException(404, "bank not found")
    plan.name = payload.name
    plan.bank_id = payload.bank_id
    plan.daily_goal = payload.daily_goal
    session.add(plan)
    session.commit()
    return _plan_dict(session, user, plan)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    plan = session.get(Plan, plan_id)
    if plan is None or plan.owner_id != user.id:
        raise HTTPException(404, "plan not found")
    session.delete(plan)
    session.commit()
    return {"deleted": plan_id}
