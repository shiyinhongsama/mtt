from datetime import datetime

from sqlmodel import Field, SQLModel
from sqlalchemy import Index

from mtt.timeutil import utcnow


class User(SQLModel, table=True):
    """账户。role: admin | user（R-identity-02）。"""

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    hashed_password: str
    role: str = Field(default="user")
    is_active: bool = True
    created_at: datetime = Field(default_factory=utcnow)


class ApiToken(SQLModel, table=True):
    """令牌访问；可吊销（R-identity-08）。一个账户可持有多个（多端使用）。"""

    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)
    last_used_at: datetime | None = None  # 最近使用时间（authenticate 时刷新）
    revoked: bool = False


class UserPreference(SQLModel, table=True):
    """跨设备同步的轻量用户偏好；值使用 JSON 字符串。"""

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    key: str
    value: str

    __table_args__ = (
        Index("uq_userpreference_user_key", "user_id", "key", unique=True),
    )
