"""corpus 接口：题库管理（R-api-09 的子集）。

- 手动新增/编辑/删除题目（R-corpus-05）：手工题与生成题同模型
- 预览区：pending → confirm 后才进复习队列（R-generate-05）
- 树形分类创建（R-corpus-02）
"""

import json
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session, func, or_, select

from mtt.corpus import transfer
from mtt.corpus.models import Category, Question, QuestionBank
from mtt.corpus.service import create_question, ensure_default_bank, to_dict
from mtt.corpus.validation import validate_question
from mtt.db import get_session
from mtt.deps import get_current_user
from mtt.identity.models import User
from mtt.schedule.models import ReviewLog

router = APIRouter(prefix="/questions", tags=["corpus"])

VALID_QTYPES = {"choice", "blank", "judge", "qa", "scenario"}
# choice 选择 / blank 填空 / judge 判断：自动判定
# qa 问答 / scenario 场景设计：主观题，无自动判定，走四档自评（A2）


class QuestionCreate(BaseModel):
    stem: str
    answer: str
    qtype: str = "choice"
    options: list[str] = []
    explanation: str = ""
    source: str = ""
    tags: list[str] = []
    difficulty: int = Field(default=3, ge=1, le=5)
    category_id: int | None = None
    bank_id: int | None = None   # 省略则归默认题库
    status: str = "pending"  # 默认进预览区，确认后才入复习队列


class QuestionUpdate(BaseModel):
    stem: str | None = None
    answer: str | None = None
    qtype: str | None = None
    options: list[str] | None = None
    explanation: str | None = None
    source: str | None = None
    tags: list[str] | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    category_id: int | None = None
    bank_id: int | None = None


class CategoryCreate(BaseModel):
    name: str
    parent_id: int | None = None


class BankCreate(BaseModel):
    name: str
    description: str = ""


def _get_owned(session: Session, user: User, question_id: int) -> Question:
    q = session.get(Question, question_id)
    if q is None or q.owner_id != user.id:  # 数据隔离（R-identity-03）
        raise HTTPException(404, "question not found")
    return q


# ---------- 题库 ----------

@router.get("/banks")
def list_banks(user: User = Depends(get_current_user),
               session: Session = Depends(get_session)) -> list[dict]:
    """题库列表（含在库题目数）。每个用户至少有一个默认题库。"""
    banks = session.exec(
        select(QuestionBank).where(QuestionBank.owner_id == user.id)).all()
    if not any(b.is_default for b in banks):
        banks.append(ensure_default_bank(session, user.id))
    counts = {
        bid: n for bid, n in session.exec(
            select(Question.bank_id, func.count())
            .where(Question.owner_id == user.id, Question.status == "active")
            .group_by(Question.bank_id)).all()
    }
    return [{"id": b.id, "name": b.name, "description": b.description,
             "is_default": b.is_default, "question_count": counts.get(b.id, 0),
             "created_at": b.created_at} for b in banks]


@router.post("/banks", status_code=201)
def create_bank(payload: BankCreate, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    if session.exec(select(QuestionBank).where(
            QuestionBank.owner_id == user.id,
            QuestionBank.name == payload.name)).first():
        raise HTTPException(409, "同名题库已存在")
    b = QuestionBank(owner_id=user.id, name=payload.name,
                     description=payload.description)
    session.add(b)
    session.commit()
    session.refresh(b)
    return {"id": b.id, "name": b.name, "description": b.description,
            "is_default": False}


@router.patch("/banks/{bank_id}")
def update_bank(bank_id: int, payload: BankCreate,
                user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    b = session.get(QuestionBank, bank_id)
    if b is None or b.owner_id != user.id:
        raise HTTPException(404, "bank not found")
    b.name = payload.name
    b.description = payload.description
    session.add(b)
    session.commit()
    return {"id": b.id, "name": b.name, "description": b.description}


@router.delete("/banks/{bank_id}")
def delete_bank(bank_id: int, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> dict:
    """删除题库：题目移入默认题库。默认题库不可删除。"""
    b = session.get(QuestionBank, bank_id)
    if b is None or b.owner_id != user.id:
        raise HTTPException(404, "bank not found")
    if b.is_default:
        raise HTTPException(409, "默认题库不可删除")
    default = ensure_default_bank(session, user.id)
    for q in session.exec(select(Question).where(Question.bank_id == bank_id)).all():
        q.bank_id = default.id
        session.add(q)
    session.delete(b)
    session.commit()
    return {"deleted": bank_id, "moved_to": default.id}


@router.get("/banks/{bank_id}/export")
def export_bank(bank_id: int, export_format: str = Query(default="json", alias="format"),
                user: User = Depends(get_current_user),
                session: Session = Depends(get_session)) -> Response:
    """按题库导出题目内容：JSON 便于再导入，CSV 便于在表格软件里查看和编辑。"""
    bank = transfer.owned_bank(session, user.id, bank_id)
    if bank is None:
        raise HTTPException(404, "bank not found")
    if export_format not in ("json", "csv"):
        raise HTTPException(422, "format must be json or csv")
    stamp = datetime.now().strftime("%Y-%m-%d")
    if export_format == "json":
        payload = json.dumps(transfer.export_bank_json(session, user.id, bank),
                             ensure_ascii=False, indent=2).encode("utf-8")
        media_type, extension = "application/json; charset=utf-8", "json"
    else:
        # BOM 让表格软件按 UTF-8 打开中文
        payload = transfer.export_bank_csv(session, user.id, bank).encode("utf-8-sig")
        media_type, extension = "text/csv; charset=utf-8", "csv"
    filename = f"题库-{bank.name}-{stamp}.{extension}"
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition":
                f"attachment; filename=\"bank-{bank.id}-{stamp}.{extension}\"; "
                f"filename*=UTF-8''{quote(filename)}",
        },
    )

@router.get("")
def list_questions(status: str | None = "active", bank_id: int | None = None,
                   qtype: str | None = None, category_id: int | None = None,
                   difficulty: int | None = None, q: str | None = None,
                   page: int = 1, page_size: int = 15,
                   user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)) -> dict:
    """题目多条件组合查询 + 服务端分页（R-api-09 题库管理接口）。

    status 传空字符串表示全部状态；category_id 含全部后代分类；
    q 匹配题面/答案/标签（不区分大小写）。
    """
    stmt = select(Question).where(Question.owner_id == user.id)
    if status:
        stmt = stmt.where(Question.status == status)
    if bank_id is not None:
        stmt = stmt.where(Question.bank_id == bank_id)
    if qtype:
        stmt = stmt.where(Question.qtype == qtype)
    if difficulty is not None:
        stmt = stmt.where(Question.difficulty == difficulty)
    if category_id is not None:
        root = session.get(Category, category_id)
        if root is None or root.owner_id != user.id:
            raise HTTPException(404, "category not found")
        ids = _descendant_category_ids(session, user, category_id)
        stmt = stmt.where(Question.category_id.in_(ids))
    if q and q.strip():
        kw = q.strip()
        stmt = stmt.where(or_(Question.stem.contains(kw),
                              Question.answer.contains(kw),
                              Question.tags.contains(kw)))

    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = session.exec(
        stmt.order_by(Question.id.desc())
        .offset((page - 1) * page_size).limit(page_size)).all()
    return {"total": total, "items": [to_dict(x) for x in rows]}


def _descendant_category_ids(session: Session, user: User, root_id: int) -> set[int]:
    cats = session.exec(select(Category).where(Category.owner_id == user.id)).all()
    children: dict[int | None, list[int]] = {}
    for c in cats:
        children.setdefault(c.parent_id, []).append(c.id)
    ids = {root_id}
    stack = [root_id]
    while stack:
        for cid in children.get(stack.pop(), []):
            if cid not in ids:
                ids.add(cid)
                stack.append(cid)
    return ids


@router.post("", status_code=201)
def add_question(payload: QuestionCreate, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    if payload.qtype not in VALID_QTYPES:
        raise HTTPException(422, f"qtype must be one of {sorted(VALID_QTYPES)}")
    q = create_question(
        session, owner_id=user.id, stem=payload.stem, answer=payload.answer,
        qtype=payload.qtype, options=payload.options, explanation=payload.explanation,
        source=payload.source, tags=payload.tags, difficulty=payload.difficulty,
        category_id=payload.category_id, status=payload.status, bank_id=payload.bank_id,
    )
    return to_dict(q)


@router.post("/bulk-confirm")
def bulk_confirm(payload: dict[str, list[int]], user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    confirmed: list[int] = []
    failures: list[dict] = []
    for question_id in dict.fromkeys(payload.get("ids", [])):
        question = session.get(Question, question_id)
        if question is None or question.owner_id != user.id:
            failures.append({"id": question_id, "reason": "题目不存在"})
            continue
        if question.status != "pending":
            failures.append({"id": question_id, "reason": "仅待确认题目可确认"})
            continue
        errors = validate_question(question)
        if errors:
            failures.append({"id": question_id, "reason": "；".join(errors)})
            continue
        question.status = "active"
        session.add(question)
        confirmed.append(question_id)
    session.commit()
    return {"confirmed_ids": confirmed, "failures": failures}


@router.get("/{question_id}")
def get_question(question_id: int, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    return to_dict(_get_owned(session, user, question_id))


@router.patch("/{question_id}")
def update_question(question_id: int, payload: QuestionUpdate,
                    user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)) -> dict:
    q = _get_owned(session, user, question_id)
    import json
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field in ("options", "tags") and value is not None:
            value = json.dumps(value, ensure_ascii=False)
        setattr(q, field, value)
    errors = validate_question(q)
    content_fields = {"stem", "answer", "qtype", "options", "source"}
    if errors and content_fields & payload.model_fields_set:
        session.rollback()
        raise HTTPException(422, "；".join(errors))
    session.add(q)
    session.commit()
    session.refresh(q)
    return to_dict(q)


@router.delete("/{question_id}", status_code=204)
def delete_question(question_id: int, user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)) -> None:
    q = _get_owned(session, user, question_id)
    history = session.exec(select(ReviewLog).where(
        ReviewLog.user_id == user.id, ReviewLog.question_id == question_id)).first()
    if history is not None:
        raise HTTPException(409, "题目已有学习记录，请使用 /suspend 暂停，保留历史")
    session.delete(q)
    session.commit()


@router.post("/{question_id}/confirm")
def confirm_question(question_id: int, user: User = Depends(get_current_user),
                     session: Session = Depends(get_session)) -> dict:
    """预览区确认：进入正式复习队列（R-generate-05）。"""
    q = _get_owned(session, user, question_id)
    if q.status != "pending":
        raise HTTPException(409, f"cannot confirm question in status '{q.status}'")
    errors = validate_question(q)
    if errors:
        raise HTTPException(422, "；".join(errors))
    q.status = "active"
    session.add(q)
    session.commit()
    return {"id": q.id, "status": q.status}


@router.post("/{question_id}/flag")
def flag_question(question_id: int, user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> dict:
    """标记"有问题"，进入修复队列，不再出现于复习（R-corpus-07）。"""
    q = _get_owned(session, user, question_id)
    q.status = "flagged"
    session.add(q)
    session.commit()
    return {"id": q.id, "status": q.status}


@router.post("/{question_id}/suspend")
def suspend_question(question_id: int, user: User = Depends(get_current_user),
                     session: Session = Depends(get_session)) -> dict:
    """暂停某题，不再出现（R-schedule-06）。"""
    q = _get_owned(session, user, question_id)
    q.status = "suspended"
    session.add(q)
    session.commit()
    return {"id": q.id, "status": q.status}


@router.post("/{question_id}/reactivate")
def reactivate_question(question_id: int, user: User = Depends(get_current_user),
                        session: Session = Depends(get_session)) -> dict:
    """从已标记/已暂停恢复到在库。"""
    q = _get_owned(session, user, question_id)
    if q.status not in ("flagged", "suspended"):
        raise HTTPException(409, f"cannot reactivate question in status '{q.status}'")
    q.status = "active"
    session.add(q)
    session.commit()
    return {"id": q.id, "status": q.status}


@router.post("/categories", status_code=201)
def add_category(payload: CategoryCreate, user: User = Depends(get_current_user),
                 session: Session = Depends(get_session)) -> dict:
    if payload.parent_id is not None:
        parent = session.get(Category, payload.parent_id)
        if parent is None or parent.owner_id != user.id:
            raise HTTPException(404, "parent category not found")
    c = Category(owner_id=user.id, name=payload.name, parent_id=payload.parent_id)
    session.add(c)
    session.commit()
    session.refresh(c)
    return {"id": c.id, "name": c.name, "parent_id": c.parent_id}


@router.get("/categories/tree")
def category_tree(user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)) -> list[dict]:
    stmt = select(Category).where(Category.owner_id == user.id)
    cats = session.exec(stmt).all()
    nodes = {c.id: {"id": c.id, "name": c.name, "children": []} for c in cats}
    roots = []
    for c in cats:
        if c.parent_id and c.parent_id in nodes:
            nodes[c.parent_id]["children"].append(nodes[c.id])
        else:
            roots.append(nodes[c.id])
    return roots


@router.patch("/categories/{category_id}")
def rename_category(category_id: int, payload: CategoryCreate,
                    user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)) -> dict:
    """重命名分类（payload 只用 name）。"""
    c = session.get(Category, category_id)
    if c is None or c.owner_id != user.id:
        raise HTTPException(404, "category not found")
    c.name = payload.name
    session.add(c)
    session.commit()
    return {"id": c.id, "name": c.name}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)) -> dict:
    """删除分类；子分类上移一级，题目保留（category_id 置空）。"""
    c = session.get(Category, category_id)
    if c is None or c.owner_id != user.id:
        raise HTTPException(404, "category not found")
    for child in session.exec(select(Category).where(Category.parent_id == category_id)).all():
        child.parent_id = c.parent_id
        session.add(child)
    for q in session.exec(select(Question).where(Question.category_id == category_id)).all():
        q.category_id = None
        session.add(q)
    session.delete(c)
    session.commit()
    return {"deleted": category_id}
