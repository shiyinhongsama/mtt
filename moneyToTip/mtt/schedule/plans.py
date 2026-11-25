"""训练计划接口：每日目标 + 加练（百词斩式玩法，§16.2 一等公民）。"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlmodel import Session, func, select

from mtt.corpus.models import Question, QuestionBank
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User, UserPreference
from mtt.schedule.models import Plan, ReviewLog
from mtt.timeutil import local_day_start_utc

router = APIRouter(prefix="/plans", tags=["schedule"])
ACTIVE_PLANS_KEY = "active_plan_ids"


class ActivePlans(BaseModel):
    plan_ids: list[int]


def get_active_plan_ids(session: Session, user: User) -> list[int]:
    preference = session.exec(select(UserPreference).where(
        UserPreference.user_id == user.id, UserPreference.key == ACTIVE_PLANS_KEY)).first()
    if preference is None:
        return []
    try:
        value = json.loads(preference.value)
        return [int(item) for item in value] if isinstance(value, list) else []
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


@router.get("/active")
def read_active_plans(user: User = Depends(get_current_user),
                      session: Session = Depends(get_session)) -> dict:
    return {"plan_ids": get_active_plan_ids(session, user)}


@router.put("/active")
def replace_active_plans(payload: ActivePlans, user: User = Depends(get_current_user),
                         session: Session = Depends(get_session)) -> dict:
    plan_ids = list(dict.fromkeys(payload.plan_ids))
    owned = session.exec(select(Plan.id).where(
        Plan.owner_id == user.id, Plan.id.in_(plan_ids))).all() if plan_ids else []
    if len(owned) != len(plan_ids):
        raise HTTPException(404, "plan not found")
    preference = session.exec(select(UserPreference).where(
        UserPreference.user_id == user.id, UserPreference.key == ACTIVE_PLANS_KEY)).first()
    if preference is None:
        preference = UserPreference(user_id=user.id, key=ACTIVE_PLANS_KEY, value="[]")
    preference.value = json.dumps(plan_ids)
    session.add(preference)
    session.commit()
    return {"plan_ids": plan_ids}


class PlanCreate(BaseModel):
    name: str
    bank_id: int | None = None  # 空 = 全部题库
    daily_goal: int = Field(default=10, ge=1, le=200)


def _plan_progress(session: Session, user: User, plan: Plan) -> int:
    """今日在计划内完成的不同题目数；重复复习和 AI 求助不计入。"""
    stmt = (
        select(func.count(func.distinct(ReviewLog.question_id)))
        .select_from(ReviewLog)
        .join(Question, Question.id == ReviewLog.question_id)
        .where(
            ReviewLog.user_id == user.id,
            ReviewLog.is_help_request == False,  # noqa: E712
            ReviewLog.reviewed_at >= local_day_start_utc(),
        )
    )
    legacy = ReviewLog.plan_id.is_(None)
    if plan.bank_id is not None:
        legacy = and_(legacy, Question.bank_id == plan.bank_id)
    stmt = stmt.where(or_(ReviewLog.plan_id == plan.id, legacy))
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
