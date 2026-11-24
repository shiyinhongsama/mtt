from datetime import datetime

from sqlmodel import Field, SQLModel

from mtt.timeutil import utcnow


class MaterialUnit(SQLModel, table=True):
    """原始材料单元（R-capture-02/05）。

    source_locator 保留原文定位（文件路径 + 标题路径/锚点），任一单元可定位回原文。
    content_hash 用于去重：同一材料二次导入不产生重复内容（R-capture-06）。
    """

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    source_locator: str          # 如 "知识库/学习/大模型/attention.md#多头注意力"
    content_hash: str = Field(index=True)
    content: str                 # 正文（Markdown）
    images: str = "[]"           # JSON list[{name, data_ref}]，与所在段落绑定（R-capture-03）
    links: str = "[]"            # JSON list[str]，[[wikilink]] 识别为关联边（R-capture-02）
    created_at: datetime = Field(default_factory=utcnow)


class ImportTask(SQLModel, table=True):
    """导入任务：可中断、可续跑，报告失败项（R-capture-07）；与生成任务同一套机制（R-api-04）。"""

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int = Field(foreign_key="user.id", index=True)
    kind: str = "markdown_package"  # markdown_package | anki_apkg | ...
    status: str = "pending"         # pending | running | done | failed
    report: str = "{}"              # JSON：成功/失败项与原因
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)
