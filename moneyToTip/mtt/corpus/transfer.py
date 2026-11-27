"""单个题库的导出与导入：只搬运题目内容，不带学习进度。"""

import csv
import io
import json
from datetime import UTC, datetime

from sqlmodel import Session, select

from mtt.corpus.models import Category, Question, QuestionBank
from mtt.corpus.service import resolve_category_path
from mtt.corpus.validation import validate_question

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


_HEADER_ALIASES = {
    "stem": {"stem", "front", "question", "题面", "问题"},
    "answer": {"answer", "back", "答案", "解答"},
    "qtype": {"qtype", "type", "题型"},
    "options": {"options", "选项"},
    "explanation": {"explanation", "讲解", "解析"},
    "source": {"source", "来源"},
    "tags": {"tags", "标签"},
    "difficulty": {"difficulty", "难度"},
    "category": {"category", "分类"},
    "status": {"status", "状态"},
}


def _normal_header(value: str) -> str:
    return value.strip().lower().replace(" ", "").replace("_", "")


_HEADER_LOOKUP = {
    _normal_header(alias): field
    for field, aliases in _HEADER_ALIASES.items()
    for alias in aliases
}
_QTYPE_LOOKUP = {value: key for key, value in QTYPE_LABELS.items()}
_STATUS_LOOKUP = {value: key for key, value in STATUS_LABELS.items()}
_REPORT_LIMIT = 100


def _json_rows(payload: object) -> list[tuple[int, object]]:
    if isinstance(payload, dict):
        if payload.get("format") != BANK_EXPORT_FORMAT or payload.get("version") != BANK_EXPORT_VERSION:
            raise ValueError("不是有效的题库导出文件")
        items = payload.get("questions")
    else:
        items = payload
    if not isinstance(items, list):
        raise ValueError("JSON 文件必须是题目数组或题库导出文件")
    if not items:
        raise ValueError("文件没有数据行")
    return [(index, item) for index, item in enumerate(items, start=1)]


def _table_rows(text: str, delimiter: str) -> list[tuple[int, dict[str, object]]]:
    try:
        rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    except csv.Error as exc:
        raise ValueError(f"表格文件解析失败：{exc}") from exc
    if not rows or not any(cell.strip() for cell in rows[0]):
        raise ValueError("文件为空或缺少表头")
    fields = [_HEADER_LOOKUP.get(_normal_header(cell)) for cell in rows[0]]
    if not {"stem", "answer"}.issubset({field for field in fields if field}):
        raise ValueError("表头至少需要题面和答案两列")
    result = []
    for line, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue
        values: dict[str, object] = {}
        for index, field in enumerate(fields):
            if field is not None and index < len(row):
                values[field] = row[index]
        result.append((line, values))
    if not result:
        raise ValueError("文件没有数据行")
    return result


def _text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _list_value(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        if not all(isinstance(item, str) for item in value):
            raise ValueError(f"{field}必须是字符串列表")
        return [item.strip() for item in value if item.strip()]
    raw = _text(value)
    if not raw:
        return []
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{field}格式不正确") from exc
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError(f"{field}必须是字符串列表")
        return [item.strip() for item in parsed if item.strip()]
    if field in {"tags", "标签"}:
        return raw.replace(",", " ").split()
    if "|" in raw:
        return [item.strip() for item in raw.split("|") if item.strip()]
    return [item.strip() for item in raw.splitlines() if item.strip()]


def _normalize_row(raw: object, filename: str) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("数据行必须是对象")
    stem = _text(raw.get("stem"))
    answer = _text(raw.get("answer"))
    if not stem:
        raise ValueError("缺少题面")
    if not answer:
        raise ValueError("缺少答案")

    qtype = _text(raw.get("qtype")) or "choice"
    qtype = _QTYPE_LOOKUP.get(qtype, qtype)
    if qtype not in QTYPE_LABELS:
        raise ValueError("题型无法识别")
    status = _text(raw.get("status")) or "pending"
    status = _STATUS_LOOKUP.get(status, status)
    if status not in STATUS_LABELS:
        raise ValueError("状态无法识别")
    difficulty_raw = _text(raw.get("difficulty"))
    try:
        difficulty = int(difficulty_raw) if difficulty_raw else 3
    except ValueError as exc:
        raise ValueError("难度必须是 1～5 的整数") from exc
    if not 1 <= difficulty <= 5:
        raise ValueError("难度必须是 1～5 的整数")
    category = raw.get("category")
    if category is not None and not isinstance(category, str):
        raise ValueError("分类必须是 :: 分隔的文本路径")
    return {
        "stem": stem,
        "answer": answer,
        "qtype": qtype,
        "options": _list_value(raw.get("options"), "选项"),
        "explanation": _text(raw.get("explanation")),
        "source": _text(raw.get("source")) or f"导入：{filename}",
        "tags": _list_value(raw.get("tags"), "标签"),
        "difficulty": difficulty,
        "status": status,
        "category": category.strip() if isinstance(category, str) and category.strip() else None,
    }


def import_bank_file(session: Session, owner_id: int, bank: QuestionBank,
                     filename: str, content: bytes) -> dict:
    """解析并导入目标题库；先完成整份解析，再写题目，避免坏文件留下半份数据。"""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {"json", "csv", "tsv", "txt"}:
        raise ValueError("只支持 .json / .csv / .tsv / .txt")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("文件必须是 UTF-8 编码") from exc
    if suffix == "json":
        try:
            rows = _json_rows(json.loads(text))
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON 解析失败：{exc.msg}") from exc
    else:
        rows = _table_rows(text, "\t" if suffix in {"tsv", "txt"} else ",")

    invalid: list[dict] = []
    needs_review: list[dict] = []
    truncated = False

    def report_item(target: list[dict], item: dict) -> None:
        nonlocal truncated
        if len(target) < _REPORT_LIMIT:
            target.append(item)
        else:
            truncated = True

    prepared: list[tuple[int, dict]] = []
    for line, raw in rows:
        try:
            prepared.append((line, _normalize_row(raw, filename)))
        except ValueError as exc:
            report_item(invalid, {"line": line, "reason": str(exc)})

    existing = session.exec(select(Question).where(
        Question.owner_id == owner_id, Question.bank_id == bank.id)).all()
    seen = {(question.stem, question.answer) for question in existing}
    category_cache: dict[str, int | None] = {}
    by_status: dict[str, int] = {}
    created = 0
    duplicates = 0
    for line, item in prepared:
        key = (item["stem"], item["answer"])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        path = item["category"]
        if path and path not in category_cache:
            category_cache[path] = resolve_category_path(session, owner_id, path)
        question = Question(
            owner_id=owner_id,
            bank_id=bank.id,
            category_id=category_cache.get(path) if path else None,
            qtype=item["qtype"],
            stem=item["stem"],
            answer=item["answer"],
            options=json.dumps(item["options"], ensure_ascii=False),
            explanation=item["explanation"],
            source=item["source"],
            tags=json.dumps(item["tags"], ensure_ascii=False),
            difficulty=item["difficulty"],
            status=item["status"],
        )
        if question.status == "active":
            reasons = validate_question(question)
            if reasons:
                # 不能直接进入复习队列的题保留在预览区，不丢弃用户内容
                question.status = "pending"
                report_item(needs_review, {"line": line, "stem": question.stem, "reasons": reasons})
        session.add(question)
        created += 1
        by_status[question.status] = by_status.get(question.status, 0) + 1
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {
        "bank": bank.name,
        "created": created,
        "duplicates": duplicates,
        "by_status": by_status,
        "invalid": invalid,
        "needs_review": needs_review,
        "truncated": truncated,
    }
