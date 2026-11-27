"""单个题库的导出与导入：只搬运题目内容，不带学习进度。"""

import csv
import io
import json
from datetime import UTC, datetime

from sqlmodel import Session, select

from mtt.corpus.models import Category, Question, QuestionBank

BANK_EXPORT_FORMAT = "moneytotip-bank"
BANK_EXPORT_VERSION = 1

QTYPE_LABELS = {
    "choice": "选择", "blank": "填空", "judge": "判断", "qa": "问答", "scenario": "场景设计",
}
STATUS_LABELS = {
    "pending": "待确认", "active": "复习中", "flagged": "需修正", "suspended": "已暂停",
}
CSV_HEADER = ["题面", "答案", "题型", "选项", "讲解", "来源", "标签", "难度", "分类", "状态"]


def owned_bank(session: Session, owner_id: int, bank_id: int) -> QuestionBank | None:
    bank = session.get(QuestionBank, bank_id)
    if bank is None or bank.owner_id != owner_id:
        return None
    return bank


def _list_field(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _category_path(session: Session, category_id: int | None) -> str | None:
    """从末级分类往上拼出 `::` 路径；分类被删或成环时按已有部分返回。"""
    names: list[str] = []
    seen: set[int] = set()
    while category_id is not None and category_id not in seen:
        seen.add(category_id)
        category = session.get(Category, category_id)
        if category is None:
            break
        names.append(category.name)
        category_id = category.parent_id
    return "::".join(reversed(names)) or None


def _bank_questions(session: Session, owner_id: int, bank: QuestionBank) -> list[tuple[Question, str | None]]:
    stmt = (select(Question)
            .where(Question.owner_id == owner_id, Question.bank_id == bank.id)
            .order_by(Question.id))
    return [(question, _category_path(session, question.category_id))
            for question in session.exec(stmt).all()]


def export_bank_json(session: Session, owner_id: int, bank: QuestionBank) -> dict:
    questions = []
    for question, path in _bank_questions(session, owner_id, bank):
        questions.append({
            "stem": question.stem,
            "answer": question.answer,
            "qtype": question.qtype,
            "options": _list_field(question.options),
            "explanation": question.explanation,
            "source": question.source,
            "tags": _list_field(question.tags),
            "difficulty": question.difficulty,
            "status": question.status,
            "category": path,
        })
    return {
        "format": BANK_EXPORT_FORMAT,
        "version": BANK_EXPORT_VERSION,
        "bank": {"name": bank.name, "description": bank.description},
        "exported_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "questions": questions,
    }


def export_bank_csv(session: Session, owner_id: int, bank: QuestionBank) -> str:
    """选项一格一行、标签空格分隔，方便在表格软件里直接编辑。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for question, path in _bank_questions(session, owner_id, bank):
        writer.writerow([
            question.stem,
            question.answer,
            QTYPE_LABELS.get(question.qtype, question.qtype),
            "\n".join(_list_field(question.options)),
            question.explanation,
            question.source,
            " ".join(_list_field(question.tags)),
            str(question.difficulty),
            path or "",
            STATUS_LABELS.get(question.status, question.status),
        ])
    return buffer.getvalue()
