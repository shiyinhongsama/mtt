"""管理端 CLI（D4：题库管理放 Web/CLI；R-identity-01 管理员创建账户）。

用法：
    mtt serve                      # 启动服务端
    mtt init-db                    # 初始化数据库
    mtt user-create shiyinhong --admin   # 创建管理员并发放令牌
    mtt question-add --stem "..." --answer "..." [--options "甲|乙|丙"]
    mtt question-import questions.json   # 批量导入（JSON 数组，同 question-add 字段）
    mtt question-list [--status pending] [--confirm-all]
"""

import json
import secrets

import typer
import uvicorn
from sqlmodel import Session, select

from mtt.corpus.models import Question
from mtt.corpus.service import create_question, resolve_category_path, to_dict
from mtt.db import engine, init_db
from mtt.identity.service import create_user

app = typer.Typer(help="忙里偷题 (Money to Tip) — Small tips, big steps.")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
    """启动服务端。"""
    uvicorn.run("mtt.main:app", host=host, port=port, reload=reload)


@app.command(name="init-db")
def init_db_cmd() -> None:
    """初始化数据库（建表）。"""
    init_db()
    typer.echo("database initialized.")


@app.command(name="user-create")
def user_create(username: str, password: str | None = None,
                admin: bool = False) -> None:
    """创建账户并发放初始凭证；password 省略则随机生成。"""
    generated = password is None
    password = password or secrets.token_urlsafe(9)
    with Session(engine) as session:
        user, token = create_user(session, username, password=password,
                                  role="admin" if admin else "user")
        user_id, username_out, role_out = user.id, user.username, user.role
    typer.echo(f"user created: id={user_id} username={username_out} role={role_out}")
    if generated:
        typer.echo(f"initial password: {password}")
    typer.echo(f"api token: {token}")


@app.command(name="token-create")
def token_create(username: str) -> None:
    """给已有账户签发一个新 API token（旧 token 仍然有效，可单独吊销）。"""
    with Session(engine) as session:
        user = _get_user(session, username)
        from mtt.identity.service import create_token
        token = create_token(session, user)
    typer.echo(f"api token: {token}")


@app.command(name="question-add")
def question_add(stem: str, answer: str, qtype: str = "choice",
                 options: str | None = None, explanation: str = "",
                 source: str = "", tags: str = "", difficulty: int = 3,
                 status: str = "pending", bank: str | None = None,
                 owner: str | None = None) -> None:
    """新增一道题（默认进预览区，确认后入复习队列）。options/tags 用 | 或 , 分隔。"""
    opts = [o for o in (options or "").split("|") if o]
    tag_list = [t for t in (tags or "").replace("|", ",").split(",") if t.strip()]
    with Session(engine) as session:
        user = _get_user(session, owner)
        bank_id = _resolve_bank(session, user.id, bank) if bank else None
        q = create_question(
            session, owner_id=user.id, stem=stem, answer=answer, qtype=qtype,
            options=opts, explanation=explanation, source=source,
            tags=tag_list, difficulty=difficulty, status=status, bank_id=bank_id,
        )
        out = to_dict(q)
    typer.echo(json.dumps(out, ensure_ascii=False))


@app.command(name="question-import")
def question_import(file: str, status: str = "pending", owner: str | None = None) -> None:
    """从 JSON 文件批量导入题目：数组，元素字段同 question-add。"""
    items = json.loads(open(file, encoding="utf-8").read())
    if not isinstance(items, list):
        raise typer.BadParameter("JSON 文件必须是数组")
    ok, fail = 0, 0
    with Session(engine) as session:
        user = _get_user(session, owner)
        for item in items:
            try:
                category_id = item.get("category_id")
                if not category_id and item.get("category"):
                    category_id = resolve_category_path(session, user.id, item["category"])
                bank_id = item.get("bank_id")
                if not bank_id and item.get("bank"):
                    bank_id = _resolve_bank(session, user.id, item["bank"])
                create_question(
                    session, owner_id=user.id,
                    stem=item["stem"], answer=item["answer"],
                    qtype=item.get("qtype", "choice"),
                    options=item.get("options", []),
                    explanation=item.get("explanation", ""),
                    source=item.get("source", ""),
                    tags=item.get("tags", []),
                    difficulty=item.get("difficulty", 3),
                    category_id=category_id,
                    status=item.get("status", status),
                    bank_id=bank_id,
                )
                ok += 1
            except Exception as e:  # noqa: BLE001
                fail += 1
                typer.echo(f"skip: {item.get('stem', '?')[:30]}... ({e})", err=True)
    typer.echo(f"imported {ok}, failed {fail}")


@app.command(name="question-list")
def question_list(status: str = "pending", owner: str | None = None,
                  confirm_all: bool = False) -> None:
    """列出题目；--confirm-all 批量把预览区题确认入队。"""
    with Session(engine) as session:
        user = _get_user(session, owner)
        stmt = select(Question).where(Question.owner_id == user.id)
        if status:
            stmt = stmt.where(Question.status == status)
        questions = session.exec(stmt).all()
        if confirm_all:
            n = 0
            for q in questions:
                if q.status == "pending":
                    q.status = "active"
                    session.add(q)
                    n += 1
            session.commit()
            typer.echo(f"confirmed {n} questions")
            return
        for q in questions:
            typer.echo(f"[{q.id}] ({q.qtype}) {q.stem[:50]}  -> {q.answer[:30]}")
        typer.echo(f"total: {len(questions)}")


def _get_user(session: Session, username: str | None):
    from mtt.identity.models import User
    if username:
        user = session.exec(select(User).where(User.username == username)).first()
    else:
        user = session.exec(
            select(User).where(User.role == "admin").order_by(User.id)).first()
    if user is None:
        raise typer.BadParameter(f"user '{username}' not found")
    return user


def _resolve_bank(session: Session, owner_id: int, name: str) -> int:
    """按名称查找题库，不存在则创建。"""
    from mtt.corpus.models import QuestionBank
    bank = session.exec(select(QuestionBank).where(
        QuestionBank.owner_id == owner_id, QuestionBank.name == name)).first()
    if bank is None:
        bank = QuestionBank(owner_id=owner_id, name=name, description="")
        session.add(bank)
        session.commit()
        session.refresh(bank)
    return bank.id


if __name__ == "__main__":
    app()
