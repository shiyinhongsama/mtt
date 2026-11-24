from datetime import datetime

from sqlmodel import Field, SQLModel

from mtt.timeutil import utcnow


class GenerationTask(SQLModel, table=True):
    """出题任务：排队/进行中/完成/失败，长任务不阻塞接口（R-api-03）。"""

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    material_unit_id: int | None = Field(default=None, foreign_key="materialunit.id")
    status: str = "pending"     # pending | running | done | failed
    params: str = "{}"          # JSON：题型、数量、模型等
    report: str = "{}"          # JSON：产出题数、校验通过率、丢弃原因
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)
