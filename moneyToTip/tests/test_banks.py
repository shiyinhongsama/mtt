"""题库验收：CRUD、默认题库、题目归属、按题库过滤复习队列。"""


def _create_bank(client, auth, name="Java 面试", description="八股与源码"):
    r = client.post("/api/v1/questions/banks", headers=auth,
                    json={"name": name, "description": description})
    assert r.status_code == 201
    return r.json()


def test_default_bank_auto_created(client, auth):
    """未建任何题库时，系统自动给出默认题库。"""
    banks = client.get("/api/v1/questions/banks", headers=auth).json()
    assert len(banks) >= 1
    assert any(b["is_default"] for b in banks)


def test_bank_crud(client, auth):
    bank = _create_bank(client, auth)
    # 重名冲突
    assert client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "Java 面试"}).status_code == 409
    # 编辑
    r = client.patch(f"/api/v1/questions/banks/{bank['id']}", headers=auth,
                     json={"name": "Java 面试 v2", "description": "改备注"})
    assert r.json()["name"] == "Java 面试 v2"
    # 删除
    assert client.delete(f"/api/v1/questions/banks/{bank['id']}",
                         headers=auth).status_code == 200


def test_question_belongs_to_bank(client, auth, active_question):
    """未指定题库的题目归默认题库；指定则归指定题库。"""
    bank = _create_bank(client, auth, name="网络基础")
    # active_question fixture 未指定 → 默认题库
    banks = client.get("/api/v1/questions/banks", headers=auth).json()
    default = next(b for b in banks if b["is_default"])
    assert active_question.bank_id == default["id"]

    # 指定题库创建
    r = client.post("/api/v1/questions", headers=auth, json={
        "stem": "OSI 七层模型最上层是？", "answer": "应用层", "qtype": "blank",
        "bank_id": bank["id"], "status": "active"})
    assert r.json()["bank_id"] == bank["id"]

    # 按题库过滤列表
    listed = client.get(f"/api/v1/questions?status=active&bank_id={bank['id']}",
                        headers=auth).json()["items"]
    assert len(listed) == 1 and listed[0]["stem"].startswith("OSI")

    # 按题库过滤复习队列
    due = client.get(f"/api/v1/reviews/due?bank_id={bank['id']}",
                     headers=auth).json()
    assert [q["id"] for q in due] == [r.json()["id"]]

    # 编辑可换题库
    client.patch(f"/api/v1/questions/{r.json()['id']}", headers=auth,
                 json={"bank_id": default["id"]})
    assert client.get(f"/api/v1/questions?status=active&bank_id={bank['id']}",
                      headers=auth).json()["items"] == []


def test_delete_bank_moves_questions(client, auth):
    bank = _create_bank(client, auth, name="临时题库")
    r = client.post("/api/v1/questions", headers=auth, json={
        "stem": "临时题", "answer": "x", "bank_id": bank["id"], "status": "active"})
    # 默认题库不可删除
    banks = client.get("/api/v1/questions/banks", headers=auth).json()
    default = next(b for b in banks if b["is_default"])
    assert client.delete(f"/api/v1/questions/banks/{default['id']}",
                         headers=auth).status_code == 409
    # 删除后题目归入默认题库
    client.delete(f"/api/v1/questions/banks/{bank['id']}", headers=auth)
    q = client.get(f"/api/v1/questions/{r.json()['id']}", headers=auth).json()
    assert q["bank_id"] == default["id"]
