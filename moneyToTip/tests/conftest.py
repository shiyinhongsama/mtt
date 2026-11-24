import os
import secrets
import tempfile

# 必须在导入 mtt 之前设置测试数据库
_tmp = tempfile.mkdtemp(prefix="mtt-test-")
os.environ["MTT_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "test.db")
os.environ["MTT_DATA_DIR"] = os.path.join(_tmp, "data")

import pytest
from fastapi.testclient import TestClient

from mtt.corpus.service import create_question
from mtt.db import engine, init_db
from mtt.identity.service import create_user
from mtt.main import create_app
from mtt.schedule.models import QuestionState
from sqlmodel import Session, select


@pytest.fixture(scope="session")
def client():
    init_db()
    return TestClient(create_app())


@pytest.fixture(scope="session")
def admin(client):
    """创建管理员账户，返回 (user_id, token)。"""
    with Session(engine) as session:
        user, token = create_user(session, "admin", password="pw", role="admin")
        user_id = user.id
    return user_id, token


@pytest.fixture(scope="session")
def auth(client, admin):
    _, token = admin
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def active_question(client, admin):
    """一道已确认（active）的题；题面每次唯一，避免跨测试内容撞车。"""
    user_id, _ = admin
    with Session(engine) as session:
        return create_question(
            session, owner_id=user_id,
            stem=f"HTTP 的默认端口是？（{secrets.token_hex(3)}）", answer="80",
            qtype="blank", source="学习/网络/HTTP.md#基础",
            tags=["网络"], status="active",
        )


def get_state(user_id: int, question_id: int) -> QuestionState | None:
    with Session(engine) as session:
        stmt = select(QuestionState).where(
            QuestionState.user_id == user_id,
            QuestionState.question_id == question_id,
        )
        return session.exec(stmt).first()
