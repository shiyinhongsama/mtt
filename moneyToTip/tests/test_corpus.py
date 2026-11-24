"""corpus 功能验收：增删改查、预览区确认、分类树、静态页面、组合查询。"""

from sqlmodel import Session, select

from mtt.corpus.models import Category


def test_question_crud(client, auth):
    # 创建（默认进预览区）
    r = client.post("/api/v1/questions", headers=auth, json={
        "stem": "TCP 三次握手的第二步是？", "answer": "SYN+ACK",
        "qtype": "blank", "source": "学习/网络/TCP.md#握手",
        "tags": ["网络"], "difficulty": 4,
    })
    assert r.status_code == 201
    q = r.json()
    assert q["status"] == "pending"

    # 编辑
    r = client.patch(f"/api/v1/questions/{q['id']}", headers=auth,
                     json={"explanation": "服务端回 SYN+ACK"})
    assert r.status_code == 200
    assert r.json()["explanation"] == "服务端回 SYN+ACK"

    # 确认入队
    r = client.post(f"/api/v1/questions/{q['id']}/confirm", headers=auth)
    assert r.json()["status"] == "active"

    # 删除
    r = client.delete(f"/api/v1/questions/{q['id']}", headers=auth)
    assert r.status_code == 204
    assert client.get(f"/api/v1/questions/{q['id']}", headers=auth).status_code == 404


def test_confirm_only_from_pending(client, auth, active_question):
    r = client.post(f"/api/v1/questions/{active_question.id}/confirm", headers=auth)
    assert r.status_code == 409


def test_validation(client, auth):
    r = client.post("/api/v1/questions", headers=auth, json={
        "stem": "x", "answer": "y", "qtype": "essay"})
    assert r.status_code == 422
    r = client.post("/api/v1/questions", headers=auth, json={
        "stem": "x", "answer": "y", "difficulty": 9})
    assert r.status_code == 422


def test_subjective_qtypes(client, auth):
    """问答 / 场景设计：主观题入库（自评判定在客户端，A2）。"""
    for qtype in ("qa", "scenario"):
        r = client.post("/api/v1/questions", headers=auth, json={
            "stem": f"主观题-{qtype}", "answer": "参考要点……",
            "qtype": qtype, "status": "active"})
        assert r.status_code == 201, r.text
        assert r.json()["qtype"] == qtype
    listed = client.get("/api/v1/questions?status=active", headers=auth).json()["items"]
    assert any(q["qtype"] == "qa" for q in listed)


def test_list_questions_filters(client, auth, admin):
    """多条件组合查询 + 服务端分页。"""
    from mtt.corpus.service import create_question, resolve_category_path
    from mtt.db import engine as db_engine
    admin_id, _ = admin
    with Session(db_engine) as session:
        leaf = resolve_category_path(session, admin_id, "过滤测试::子类")
        create_question(session, owner_id=admin_id, stem="过滤A关键字",
                        answer="x", status="active", qtype="qa",
                        category_id=leaf, difficulty=5, tags=["特殊标签"])
        create_question(session, owner_id=admin_id, stem="过滤B",
                        answer="y", status="pending", difficulty=1)

    def query(**kw):
        qs = "&".join(f"{k}={v}" for k, v in kw.items())
        return client.get(f"/api/v1/questions?{qs}", headers=auth).json()

    # 关键字命中题面
    assert query(status="active", q="关键字")["total"] == 1
    # 关键字命中标签
    assert query(status="active", q="特殊标签")["total"] == 1
    # 题型 + 难度
    assert query(status="active", qtype="qa", difficulty=5)["total"] == 1
    assert query(status="active", qtype="choice", difficulty=5)["total"] == 0
    # 分类（含后代）
    with Session(db_engine) as session:
        root = session.exec(select(Category).where(
            Category.owner_id == admin_id, Category.name == "过滤测试")).first()
    assert query(status="active", category_id=root.id)["total"] == 1
    # 全部状态
    assert query(status="", q="过滤")["total"] == 2
    # 分页
    page = query(status="", page=2, page_size=1)
    assert page["total"] >= 2 and len(page["items"]) == 1


def test_isolation(client, auth):
    """他人题目不可见（R-identity-03）。"""
    from sqlmodel import Session
    from mtt.db import engine
    from mtt.identity.service import create_user
    with Session(engine) as session:
        other, _ = create_user(session, "stranger", password="pw")
    r = client.get(f"/api/v1/questions/1", headers={
        "Authorization": f"Bearer {_token_of('stranger')}"})
    assert r.status_code == 404


def _token_of(username: str) -> str:
    from sqlmodel import Session, select
    from mtt.db import engine
    from mtt.identity.models import ApiToken, User
    with Session(engine) as session:
        user = session.exec(select(User).where(User.username == username)).first()
        return session.exec(
            select(ApiToken).where(ApiToken.user_id == user.id)).first().token


def test_category_tree(client, auth):
    r = client.post("/api/v1/questions/categories", headers=auth,
                    json={"name": "计算机网络"})
    assert r.status_code == 201
    root_id = r.json()["id"]
    r = client.post("/api/v1/questions/categories", headers=auth,
                    json={"name": "TCP", "parent_id": root_id})
    assert r.status_code == 201

    tree = client.get("/api/v1/questions/categories/tree", headers=auth).json()
    root = next(c for c in tree if c["id"] == root_id)
    assert root["name"] == "计算机网络"
    assert root["children"][0]["name"] == "TCP"


def test_static_pages(client):
    # App 端（moneyToTipApp 构建产物）
    assert client.get("/app/").status_code == 200
    assert client.get("/app/manifest.webmanifest").status_code == 200
    # 管理端（moneyToTipConsole 构建产物）
    assert client.get("/console/").status_code == 200
    assert client.get("/console").status_code in (200, 307, 308)
    # 产品主页
    assert client.get("/").status_code == 200
