"""题库领域逻辑。"""

import json

from sqlmodel import Session, select

from mtt.corpus.models import Category, Question, QuestionBank


def create_question(session: Session, owner_id: int, stem: str, answer: str,
                    qtype: str = "choice", options: list[str] | None = None,
                    explanation: str = "", source: str = "",
                    tags: list[str] | None = None, difficulty: int = 3,
                    category_id: int | None = None,
                    status: str = "pending", bank_id: int | None = None) -> Question:
    if bank_id is None:
        bank_id = ensure_default_bank(session, owner_id).id
    q = Question(
        owner_id=owner_id, qtype=qtype, stem=stem, answer=answer,
        options=json.dumps(options or [], ensure_ascii=False),
        explanation=explanation, source=source,
        tags=json.dumps(tags or [], ensure_ascii=False),
        difficulty=difficulty, category_id=category_id, status=status,
        bank_id=bank_id,
    )
    session.add(q)
    session.commit()
    session.refresh(q)
    return q


def ensure_default_bank(session: Session, owner_id: int) -> QuestionBank:
    """每个用户一个系统默认题库；题目未指定题库时归默认题库。"""
    stmt = select(QuestionBank).where(
        QuestionBank.owner_id == owner_id, QuestionBank.is_default == True)  # noqa: E712
    bank = session.exec(stmt).first()
    if bank is None:
        bank = QuestionBank(owner_id=owner_id, name="默认题库",
                            description="系统默认题库", is_default=True)
        session.add(bank)
        session.commit()
        session.refresh(bank)
    return bank


def resolve_category_path(session: Session, owner_id: int, path: str) -> int | None:
    """按 `::` 分隔的路径（Anki 牌组层级约定，D6）查找或创建分类，返回末级 id。"""
    current: int | None = None
    for name in [p.strip() for p in path.split("::") if p.strip()]:
        stmt = select(Category).where(
            Category.owner_id == owner_id,
            Category.name == name,
            Category.parent_id == current,
        )
        cat = session.exec(stmt).first()
        if cat is None:
            cat = Category(owner_id=owner_id, name=name, parent_id=current)
            session.add(cat)
            session.commit()
            session.refresh(cat)
        current = cat.id
    return current


def to_dict(q: Question) -> dict:
    return {
        "id": q.id,
        "qtype": q.qtype,
        "stem": q.stem,
        "options": json.loads(q.options),
        "answer": q.answer,
        "explanation": q.explanation,
        "source": q.source,
        "tags": json.loads(q.tags),
        "difficulty": q.difficulty,
        "status": q.status,
        "category_id": q.category_id,
        "bank_id": q.bank_id,
    }
