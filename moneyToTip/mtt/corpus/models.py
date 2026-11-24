from datetime import datetime

from sqlmodel import Field, SQLModel

from mtt.timeutil import utcnow

from mtt.timeutil import utcnow


class Category(SQLModel, table=True):
    """树形分类（R-corpus-02），parent_id 自关联。"""

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    name: str
    parent_id: int | None = Field(default=None, foreign_key="category.id")


class QuestionBank(SQLModel, table=True):
    """题库：题目的一级容器（名称 + 备注）。每个用户有一个系统默认题库。

    未来题库级授权（R-identity-04）就挂在这张表上。
    """

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    name: str
    description: str = ""
    is_default: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Question(SQLModel, table=True):
    """题目（R-corpus-01）。内部状态码与界面用户语言分离（术语黑名单，R-session-06）：

    status: pending(预览区，未确认不入复习队列) | active | flagged(有问题，待修复) | suspended(暂停)
    """

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    category_id: int | None = Field(default=None, foreign_key="category.id")
    bank_id: int | None = Field(default=None, foreign_key="questionbank.id")

    qtype: str = "choice"  # choice | blank | judge（客观题，R-generate-01）
    stem: str
    options: str = "[]"    # JSON list[str]，choice 用
    answer: str
    explanation: str = ""
    source: str = ""       # 原文定位（文件路径 + 标题路径/锚点，R-capture-05）
    tags: str = "[]"       # JSON list[str]
    difficulty: int = 3    # 1~5

    status: str = "pending"  # pending | active | flagged | suspended
    created_at: datetime = Field(default_factory=utcnow)
