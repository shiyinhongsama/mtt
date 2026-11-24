"""数据主权领域逻辑。

导出文件保留原主键作为关联信息；导入时重新分配主键并重建关联。
重复导入按业务内容去重，复习日志优先使用 client_id 保证幂等。
"""

import json
import math
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from mtt.capture.models import ImportTask, MaterialUnit
from mtt.config import settings
from mtt.corpus.models import Category, Question, QuestionBank
from mtt.db import engine
from mtt.generate.models import GenerationTask
from mtt.schedule.memory import ALGORITHM_VERSION
from mtt.schedule.models import Plan, QuestionState, ReviewLog
from mtt.timeutil import local_midnight_as_utc

EXPORT_FORMAT = "moneytotip-export"
EXPORT_VERSION = 2


def _dump(row: Any) -> dict:
    return row.model_dump(mode="json")


def _owned(session: Session, model: type, owner_id: int, column_name: str) -> list:
    column = getattr(model, column_name)
    return session.exec(select(model).where(column == owner_id)).all()


def export_data(session: Session, owner_id: int) -> dict:
    """导出当前用户的学习数据，不包含账户凭证或其他用户的数据。"""
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "banks": [_dump(row) for row in _owned(session, QuestionBank, owner_id, "owner_id")],
        "categories": [_dump(row) for row in _owned(session, Category, owner_id, "owner_id")],
        "questions": [_dump(row) for row in _owned(session, Question, owner_id, "owner_id")],
        "states": [_dump(row) for row in _owned(session, QuestionState, owner_id, "user_id")],
        "review_logs": [_dump(row) for row in _owned(session, ReviewLog, owner_id, "user_id")],
        "plans": [_dump(row) for row in _owned(session, Plan, owner_id, "owner_id")],
    }


def _without_identity(item: dict, *extra: str) -> dict:
    excluded = {"id", "owner_id", "user_id", *extra}
    data = {key: value for key, value in item.items() if key not in excluded}
    for field in ("created_at", "reviewed_at", "due_at", "last_reviewed_at",
                  "decision_due_at"):
        value = data.get(field)
        if isinstance(value, str):
            data[field] = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return data


def _adapt_state(item: dict) -> dict:
    """将 version-1 的日期粒度状态转换为当前记忆模型。"""
    data = dict(item)
    if "due_at" not in data:
        due_date = datetime.strptime(data.pop("due_date"), "%Y-%m-%d").date()
        data["due_at"] = local_midnight_as_utc(due_date).isoformat()
    if "interval_minutes" not in data:
        days = data.pop("interval_days")
        data["interval_minutes"] = days * 1440
        data["stability_days"] = max(days / -math.log(0.85), 1 / 1440)
    if data.get("status") == "mastered":
        data["status"] = "review"
    data.setdefault("stability_days", 1.0)
    data.setdefault("lapses", 0)
    data.setdefault("last_rating", "")
    data.setdefault("last_reviewed_at", None)
    data.setdefault("algorithm_version", ALGORITHM_VERSION)
    return data


def _fingerprint(item: dict, fields: tuple[str, ...]) -> str:
    values = {}
    for field in fields:
        value = item.get(field)
        if isinstance(value, datetime):
            value = value.isoformat().replace("+00:00", "Z")
        values[field] = value
    return json.dumps(values, ensure_ascii=False, sort_keys=True, default=str)


def _ensure_default_bank(session: Session, owner_id: int) -> QuestionBank:
    bank = session.exec(select(QuestionBank).where(
        QuestionBank.owner_id == owner_id,
        QuestionBank.is_default == True,  # noqa: E712
    )).first()
    if bank is None:
        bank = QuestionBank(
            owner_id=owner_id,
            name="默认题库",
            description="系统默认题库",
            is_default=True,
        )
        session.add(bank)
        session.flush()
    return bank


def _import_banks(session: Session, owner_id: int, items: list[dict]) -> dict[int, int]:
    mapping: dict[int, int] = {}
    existing = _owned(session, QuestionBank, owner_id, "owner_id")
    by_key = {(row.name, row.is_default): row for row in existing}
    for item in items:
        key = (item["name"], item.get("is_default", False))
        row = by_key.get(key)
        if row is None:
            row = QuestionBank(owner_id=owner_id, **_without_identity(item))
            session.add(row)
            session.flush()
            by_key[key] = row
        if item.get("id") is not None:
            mapping[item["id"]] = row.id
    return mapping


def _import_categories(session: Session, owner_id: int, items: list[dict]) -> dict[int, int]:
    mapping: dict[int, int] = {}
    pending = list(items)
    while pending:
        remaining = []
        for item in pending:
            old_parent = item.get("parent_id")
            if old_parent is not None and old_parent not in mapping:
                remaining.append(item)
                continue
            parent_id = mapping.get(old_parent)
            row = session.exec(select(Category).where(
                Category.owner_id == owner_id,
                Category.name == item["name"],
                Category.parent_id == parent_id,
            )).first()
            if row is None:
                data = _without_identity(item, "parent_id")
                row = Category(owner_id=owner_id, parent_id=parent_id, **data)
                session.add(row)
                session.flush()
            if item.get("id") is not None:
                mapping[item["id"]] = row.id
        if len(remaining) == len(pending):
            raise ValueError("导入文件包含无效的分类父子关系")
        pending = remaining
    return mapping


_QUESTION_FIELDS = (
    "qtype", "stem", "options", "answer", "explanation", "source", "tags",
    "difficulty", "status", "created_at", "bank_id", "category_id",
)


def _import_questions(
    session: Session,
    owner_id: int,
    items: list[dict],
    bank_map: dict[int, int],
    category_map: dict[int, int],
) -> tuple[dict[int, int], int]:
    existing = _owned(session, Question, owner_id, "owner_id")
    by_fingerprint = {_fingerprint(_dump(row), _QUESTION_FIELDS): row for row in existing}
    mapping: dict[int, int] = {}
    imported = 0
    for item in items:
        data = _without_identity(item, "bank_id", "category_id")
        old_bank = item.get("bank_id")
        old_category = item.get("category_id")
        bank_id = bank_map.get(old_bank) if old_bank is not None else None
        category_id = category_map.get(old_category) if old_category is not None else None
        if old_bank is not None and bank_id is None:
            raise ValueError(f"题目引用了不存在的题库：{old_bank}")
        if old_category is not None and category_id is None:
            raise ValueError(f"题目引用了不存在的分类：{old_category}")
        if bank_id is None:
            bank_id = _ensure_default_bank(session, owner_id).id
        candidate = {**data, "bank_id": bank_id, "category_id": category_id}
        row = by_fingerprint.get(_fingerprint(candidate, _QUESTION_FIELDS))
        if row is None:
            row = Question(owner_id=owner_id, **candidate)
            session.add(row)
            session.flush()
            by_fingerprint[_fingerprint(_dump(row), _QUESTION_FIELDS)] = row
            imported += 1
        if item.get("id") is not None:
            mapping[item["id"]] = row.id
    return mapping, imported


def _import_states(
    session: Session,
    owner_id: int,
    items: list[dict],
    question_map: dict[int, int],
) -> int:
    imported = 0
    for item in items:
        old_question = item.get("question_id")
        question_id = question_map.get(old_question)
        if question_id is None:
            raise ValueError(f"复习状态引用了不存在的题目：{old_question}")
        exists = session.exec(select(QuestionState).where(
            QuestionState.user_id == owner_id,
            QuestionState.question_id == question_id,
        )).first()
        if exists is not None:
            continue
        data = _without_identity(_adapt_state(item), "question_id")
        session.add(QuestionState(user_id=owner_id, question_id=question_id, **data))
        imported += 1
    session.flush()
    return imported


def _import_review_logs(
    session: Session,
    owner_id: int,
    items: list[dict],
    question_map: dict[int, int],
    plan_map: dict[int, int],
) -> int:
    imported = 0
    for item in items:
        old_question = item.get("question_id")
        question_id = question_map.get(old_question)
        if question_id is None:
            raise ValueError(f"复习日志引用了不存在的题目：{old_question}")
        client_id = item.get("client_id", "")
        if client_id:
            exists = session.exec(select(ReviewLog).where(
                ReviewLog.client_id == client_id,
            )).first()
            if exists is not None:
                continue
        old_plan = item.get("plan_id")
        plan_id = plan_map.get(old_plan) if old_plan is not None else None
        if old_plan is not None and plan_id is None:
            raise ValueError(f"复习日志引用了不存在的计划：{old_plan}")
        data = _without_identity(item, "question_id", "plan_id")
        session.add(ReviewLog(
            user_id=owner_id, question_id=question_id, plan_id=plan_id, **data
        ))
        session.flush()
        imported += 1
    return imported


def _import_plans(
    session: Session,
    owner_id: int,
    items: list[dict],
    bank_map: dict[int, int],
) -> tuple[dict[int, int], int]:
    imported = 0
    mapping: dict[int, int] = {}
    fields = ("name", "bank_id", "daily_goal", "created_at")
    existing = _owned(session, Plan, owner_id, "owner_id")
    by_fingerprint = {_fingerprint(_dump(row), fields): row for row in existing}
    for item in items:
        old_bank = item.get("bank_id")
        bank_id = bank_map.get(old_bank) if old_bank is not None else None
        if old_bank is not None and bank_id is None:
            raise ValueError(f"训练计划引用了不存在的题库：{old_bank}")
        data = _without_identity(item, "bank_id")
        candidate = {**data, "bank_id": bank_id}
        fingerprint = _fingerprint(candidate, fields)
        row = by_fingerprint.get(fingerprint)
        if row is None:
            row = Plan(owner_id=owner_id, **candidate)
            session.add(row)
            session.flush()
            by_fingerprint[fingerprint] = row
            imported += 1
        if item.get("id") is not None:
            mapping[item["id"]] = row.id
    return mapping, imported


def import_data(session: Session, owner_id: int, payload: dict) -> dict:
    """导入 version 1/2 导出包并返回新增记录数；同一导出包可安全重放。"""
    if payload.get("format") != EXPORT_FORMAT:
        raise ValueError("不是有效的 Money to Tip 导出文件")
    if payload.get("version", 1) not in (1, EXPORT_VERSION):
        raise ValueError("不支持的导出文件版本")
    bank_map = _import_banks(session, owner_id, payload.get("banks", []))
    category_map = _import_categories(session, owner_id, payload.get("categories", []))
    question_map, questions = _import_questions(
        session, owner_id, payload.get("questions", []), bank_map, category_map,
    )
    states = _import_states(session, owner_id, payload.get("states", []), question_map)
    plan_map, plans = _import_plans(session, owner_id, payload.get("plans", []), bank_map)
    review_logs = _import_review_logs(
        session, owner_id, payload.get("review_logs", []), question_map, plan_map,
    )
    session.commit()
    return {
        "banks": len(bank_map),
        "categories": len(category_map),
        "questions": questions,
        "states": states,
        "review_logs": review_logs,
        "plans": plans,
    }


def wipe_data(session: Session, owner_id: int) -> None:
    """清除当前用户的全部业务数据，保留用户账户和登录令牌。"""
    models = (
        (ReviewLog, "user_id"),
        (QuestionState, "user_id"),
        (GenerationTask, "owner_id"),
        (ImportTask, "owner_id"),
        (Question, "owner_id"),
        (Plan, "owner_id"),
        (Category, "owner_id"),
        (MaterialUnit, "owner_id"),
        (QuestionBank, "owner_id"),
    )
    for model, column_name in models:
        for row in _owned(session, model, owner_id, column_name):
            session.delete(row)
    session.commit()


def _backup_dir() -> Path:
    path = Path(settings.data_dir) / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _prune_backups(keep: int = 30) -> None:
    backups = sorted(_backup_dir().glob("mtt-*.db"), reverse=True)
    for path in backups[keep:]:
        path.unlink(missing_ok=True)


def create_backup() -> str:
    """使用 SQLite 在线备份 API，避免直接复制正在写入的数据库文件。"""
    database = engine.url.database
    if not database:
        raise ValueError("当前数据库不是基于文件的 SQLite")
    source_path = Path(database).resolve()
    if not source_path.exists():
        raise ValueError("数据库文件不存在")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    target = (_backup_dir() / f"mtt-{stamp}.db").resolve()
    with closing(sqlite3.connect(source_path)) as source:
        with closing(sqlite3.connect(target)) as destination:
            source.backup(destination)
    _prune_backups()
    return str(target)


def auto_backup() -> str | None:
    """当天没有任何备份时创建一份；每次调用只保留最近 30 份。"""
    today = datetime.now().strftime("%Y%m%d")
    if any(_backup_dir().glob(f"mtt-{today}-*.db")):
        _prune_backups()
        return None
    return create_backup()
