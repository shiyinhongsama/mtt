from datetime import UTC, date, datetime

from sqlmodel import Field, SQLModel

from mtt.timeutil import utcnow

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

    correct: bool = True
    rating: str = "good"        # again | hard | good | easy（四档自评，借鉴 Anki）
    duration_ms: int = 0
    is_help_request: bool = False
    reviewed_at: datetime = Field(default_factory=utcnow, index=True)


class QuestionState(SQLModel, table=True):
    """每用户每题的复习状态（排期的唯一事实都在这张表里）。"""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    question_id: int = Field(foreign_key="question.id", index=True)

    status: str = "new"          # new | learning | mastered
    interval_days: int = 0
    reps: int = 0
    due_date: date = Field(default_factory=date.today, index=True)

    __table_args__ = ({"sqlite_autoincrement": True},)


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
