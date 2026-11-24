from datetime import datetime

from sqlmodel import Field, SQLModel
from sqlalchemy import Index

from mtt.schedule.memory import ALGORITHM_VERSION
from mtt.timeutil import utcnow


class ReviewLog(SQLModel, table=True):
    """每次复习的完整记录（R-schedule-02）。

    client_id 由客户端生成，用于幂等：重复回写不产生重复日志（R-api-10）。
    is_help_request=True 表示这是一次 AI 求助，不算复习、不影响排期（R-explain-07）。
    """

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    question_id: int = Field(foreign_key="question.id", index=True)
    client_id: str = Field(default="", index=True, unique=True)
    plan_id: int | None = Field(default=None, foreign_key="plan.id", index=True)

    correct: bool = True
    rating: str = "good"        # again | hard | good | easy（四档自评，借鉴 Anki）
    duration_ms: int = 0
    is_help_request: bool = False
    reviewed_at: datetime = Field(default_factory=utcnow, index=True)
    decision_due_at: datetime | None = None
    decision_interval_minutes: int | None = None
    decision_algorithm_version: str = ""


class QuestionState(SQLModel, table=True):
    """每用户每题的复习状态（排期的唯一事实都在这张表里）。"""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    question_id: int = Field(foreign_key="question.id", index=True)

    status: str = "new"          # new | learning | review | relearning
    reps: int = 0
    lapses: int = 0
    stability_days: float = 1.0
    interval_minutes: int = 0
    due_at: datetime = Field(default_factory=utcnow, index=True)
    last_rating: str = ""
    last_reviewed_at: datetime | None = None
    algorithm_version: str = ALGORITHM_VERSION

    __table_args__ = (
        Index("uq_questionstate_user_question", "user_id", "question_id", unique=True),
        {"sqlite_autoincrement": True},
    )


class Plan(SQLModel, table=True):
    """训练计划（百词斩式每日目标）。参考需求 §16.2「每日 N 题」一等公民。

    一个计划绑定一个题库（bank_id 为空 = 全部题库）与每日目标题数。
    完成判定在客户端：今日已答（计划范围内）>= daily_goal 即达成，可继续加练。
    """

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    name: str
    bank_id: int | None = Field(default=None, foreign_key="questionbank.id")
    daily_goal: int = 10
    created_at: datetime = Field(default_factory=utcnow)
