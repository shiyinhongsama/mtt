"""管理端验收：账户管理（R-identity-01/02/07）、分类管理。"""

from sqlmodel import Session, select

from mtt.corpus.models import Question
from mtt.db import engine
from mtt.identity.service import create_user


def _token_of(username: str) -> str:
    from mtt.identity.models import ApiToken, User
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == username)).first()
        return session.exec(
            select(ApiToken).where(ApiToken.user_id == user.id)).first().token


def test_admin_creates_user(client, auth):
    """R-identity-01：管理员创建账户并发放凭证。"""
    r = client.post("/api/v1/identity/users", headers=auth, json={
        "username": "friend", "password": "pw123", "role": "user"})
    assert r.status_code == 201
    token = r.json()["token"]

    # 新账户可用，且是普通角色
    r = client.get("/api/v1/identity/me", headers={"Authorization": f"Bearer {token}"})
    assert r.json()["role"] == "user"

    # 普通用户进不了账户管理（R-identity-02）
    r = client.get("/api/v1/identity/users",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_console_login(client, auth):
    """管理端账号密码登录。"""
    with Session(engine) as session:
        create_user(session, "boss", password="s3cret", role="admin")
        create_user(session, "pal", password="pw", role="user")

    # 管理员登录成功，签发可用 token
    r = client.post("/api/v1/identity/login",
                    json={"username": "boss", "password": "s3cret"})
    assert r.status_code == 200
    token = r.json()["token"]
    assert client.get("/api/v1/identity/users",
                      headers={"Authorization": f"Bearer {token}"}).status_code == 200

    # 密码错误 / 普通用户 / 不存在
    assert client.post("/api/v1/identity/login",
                       json={"username": "boss", "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/identity/login",
                       json={"username": "pal", "password": "pw"}).status_code == 403
    assert client.post("/api/v1/identity/login",
                       json={"username": "nobody", "password": "x"}).status_code == 401


def test_admin_manage_user_tokens(client, auth):
    """管理员查看/签发/吊销账户的多个 token（R-identity-08）。"""
    with Session(engine) as session:
        uid = create_user(session, "tokuser", password="pw")[0].id

    # 初始：创建账户时签发的 1 个 token
    tokens = client.get(f"/api/v1/identity/users/{uid}/tokens", headers=auth).json()
    assert len(tokens) == 1

    # 管理员再签发一个（多端使用）
    r = client.post(f"/api/v1/identity/users/{uid}/tokens", headers=auth)
    assert r.status_code == 201
    token2 = r.json()["token"]
    tokens = client.get(f"/api/v1/identity/users/{uid}/tokens", headers=auth).json()
    assert len(tokens) == 2

    # 新 token 可用，且记录 last_used_at
    h = {"Authorization": f"Bearer {token2}"}
    assert client.get("/api/v1/identity/me", headers=h).status_code == 200
    tokens = client.get(f"/api/v1/identity/users/{uid}/tokens", headers=auth).json()
    assert any(t["last_used_at"] is not None for t in tokens)

    # 吊销第二个 token → 立即失效，第一个仍可用
    tid2 = tokens[0]["id"]  # 最新在前
    client.post(f"/api/v1/identity/tokens/{tid2}/revoke", headers=auth)
    assert client.get("/api/v1/identity/me", headers=h).status_code == 401
    tokens = client.get(f"/api/v1/identity/users/{uid}/tokens", headers=auth).json()
    assert sum(1 for t in tokens if not t["revoked"]) == 1


def test_disable_enable_user(client, auth):
    with Session(engine) as session:
        uid = create_user(session, "tempuser", password="pw")[0].id
    friend_auth = {"Authorization": f"Bearer {_token_of('tempuser')}"}
    assert client.get("/api/v1/stats", headers=friend_auth).status_code == 200

    client.post(f"/api/v1/identity/users/{uid}/disable", headers=auth)
    assert client.get("/api/v1/stats", headers=friend_auth).status_code == 401

    client.post(f"/api/v1/identity/users/{uid}/enable", headers=auth)
    assert client.get("/api/v1/stats", headers=friend_auth).status_code == 200


def test_delete_user_cascades(client, auth, admin):
    admin_id, _ = admin
    with Session(engine) as session:
        uid = create_user(session, "goner", password="pw")[0].id
        from mtt.corpus.service import create_question
        q = create_question(session, owner_id=uid, stem="?", answer="!",
                            status="active")
        qid = q.id

    r = client.delete(f"/api/v1/identity/users/{uid}", headers=auth)
    assert r.status_code == 200
    with Session(engine) as session:
        assert session.get(Question, qid) is None  # 个人数据被清除

    # 不能删除自己
    r = client.delete(f"/api/v1/identity/users/{admin_id}", headers=auth)
    assert r.status_code == 409


def test_category_rename_delete(client, auth):
    r = client.post("/api/v1/questions/categories", headers=auth, json={"name": "旧名"})
    cid = r.json()["id"]
    child = client.post("/api/v1/questions/categories", headers=auth,
                        json={"name": "子类", "parent_id": cid}).json()

    r = client.patch(f"/api/v1/questions/categories/{cid}", headers=auth,
                     json={"name": "新名"})
    assert r.json()["name"] == "新名"

    # 删除父类：子类上移
    client.delete(f"/api/v1/questions/categories/{cid}", headers=auth)
    tree = client.get("/api/v1/questions/categories/tree", headers=auth).json()
    names = [c["name"] for c in tree]
    assert "新名" not in names
    assert "子类" in names


def test_resolve_category_path(client, auth, admin):
    """`::` 路径自动建树（Anki 层级约定，D6）；幂等。"""
    from mtt.corpus.models import Category
    from mtt.corpus.service import resolve_category_path
    from mtt.db import engine as db_engine
    admin_id, _ = admin
    with Session(db_engine) as session:
        id1 = resolve_category_path(session, admin_id, "面试::Java::并发")
        id2 = resolve_category_path(session, admin_id, "面试::Java::并发")
    assert id1 == id2
    with Session(db_engine) as session:
        cats = session.exec(select(Category).where(Category.owner_id == admin_id)).all()
        top = next(c for c in cats if c.name == "面试")
        mid = next(c for c in cats if c.name == "Java")
        leaf = next(c for c in cats if c.name == "并发")
        assert mid.parent_id == top.id
        assert leaf.parent_id == mid.id
