import secrets

import pytest
from sqlmodel import Session, select

from mtt.corpus.models import Question, QuestionBank
from mtt.db import engine
from mtt.identity.models import User
from mtt.identity.service import create_user


@pytest.fixture()
def ordinary_user(client):
    username = f"user-{secrets.token_hex(4)}"
    with Session(engine) as session:
        user, token = create_user(session, username, password="correct-password", role="user")
        return {"id": user.id, "username": username, "token": token}


def user_auth(user):
    return {"Authorization": f"Bearer {user['token']}"}


def test_user_can_login_to_app(client, ordinary_user):
    response = client.post(
        "/api/v1/identity/login",
        json={"username": ordinary_user["username"], "password": "correct-password"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "user"
    assert response.json()["username"] == ordinary_user["username"]
    assert response.json()["token"]


def test_login_keeps_bad_credentials_generic(client, ordinary_user):
    response = client.post(
        "/api/v1/identity/login",
        json={"username": ordinary_user["username"], "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "用户名或密码不正确"


def test_disabled_user_cannot_login(client, ordinary_user):
    with Session(engine) as session:
        user = session.get(User, ordinary_user["id"])
        user.is_active = False
        session.add(user)
        session.commit()

    response = client.post(
        "/api/v1/identity/login",
        json={"username": ordinary_user["username"], "password": "correct-password"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "账户已被禁用"


def test_sample_onboarding_is_idempotent_and_user_scoped(client, ordinary_user):
    first_response = client.post(
        "/api/v1/identity/onboarding/sample", headers=user_auth(ordinary_user),
    )
    second_response = client.post(
        "/api/v1/identity/onboarding/sample", headers=user_auth(ordinary_user),
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    first = first_response.json()
    assert second_response.json() == first
    assert len(first["question_ids"]) == 3
    assert len(set(first["question_ids"])) == 3

    with Session(engine) as session:
        bank = session.get(QuestionBank, first["bank_id"])
        assert bank is not None
        assert bank.owner_id == ordinary_user["id"]
        questions = session.exec(
            select(Question).where(Question.id.in_(first["question_ids"])),
        ).all()
        assert len(questions) == 3
        assert all(question.owner_id == ordinary_user["id"] for question in questions)
        assert all(question.bank_id == bank.id for question in questions)
        assert all(question.source == "忙里偷题示例" for question in questions)
        assert all(question.status == "active" for question in questions)
        assert len(session.exec(
            select(Question).where(Question.owner_id == ordinary_user["id"]),
        ).all()) == 3
