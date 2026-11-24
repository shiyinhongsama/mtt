"""数据主权验收：导出→清空→导入往返一致（S-6）、可重放（S-12）、备份、销毁。"""


def _seed(client, auth, active_question):
    """答两题留下日志与状态，返回 (导出数据, 今日已答数)。"""
    client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "seed-1",
        "correct": True, "rating": "good"})
    r = client.get("/api/v1/data/export", headers=auth)
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    reviewed_today = client.get("/api/v1/stats", headers=auth).json()["reviewed_today"]
    return r.json(), reviewed_today


def test_export_import_roundtrip(client, auth, admin, active_question):
    """S-6：导出 → 清空 → 导入，数据一致。"""
    export, reviewed_today = _seed(client, auth, active_question)
    assert export["format"] == "moneytotip-export"
    assert len(export["questions"]) >= 1
    assert len(export["review_logs"]) == 1

    # 清空（需二次确认文案）
    assert client.request("DELETE", "/api/v1/data/wipe", headers=auth,
                          json={"confirm": "不对"}).status_code == 422
    r = client.request("DELETE", "/api/v1/data/wipe", headers=auth,
                       json={"confirm": "清空"})
    assert r.status_code == 200

    s = client.get("/api/v1/stats", headers=auth).json()
    assert s["active_questions"] == 0
    assert s["reviewed_today"] == 0

    # 导入恢复
    r = client.post("/api/v1/data/import", headers=auth, json=export)
    assert r.status_code == 200
    report = r.json()
    assert report["questions"] == len(export["questions"])
    assert report["review_logs"] == len(export["review_logs"])
    assert report["states"] == len(export["states"])

    s = client.get("/api/v1/stats", headers=auth).json()
    n_active = sum(1 for q in export["questions"] if q["status"] == "active")
    assert s["active_questions"] == n_active
    assert s["reviewed_today"] == reviewed_today  # 今日日志随导入恢复
    n_mature = sum(1 for st in export["states"] if st["status"] == "mastered")
    assert s["mature_count"] == n_mature  # 迁移的已掌握随导入恢复

    # 导入的题内容一致（id 由服务端重新分配，不复用旧 id 断言）
    questions = client.get("/api/v1/questions", headers=auth).json()["items"]
    stems = [q["stem"] for q in questions]
    assert active_question.stem in stems


def test_import_replay_idempotent(client, auth, active_question):
    """S-12：同一导出文件导入两次，不产生重复。"""
    export, reviewed_today = _seed(client, auth, active_question)
    client.request("DELETE", "/api/v1/data/wipe", headers=auth,
                   json={"confirm": "清空"})
    client.post("/api/v1/data/import", headers=auth, json=export)
    r = client.post("/api/v1/data/import", headers=auth, json=export)
    assert r.json()["review_logs"] == 0  # 第二次全部去重跳过
    s = client.get("/api/v1/stats", headers=auth).json()
    assert s["reviewed_today"] == reviewed_today
    n_active = sum(1 for q in export["questions"] if q["status"] == "active")
    assert s["active_questions"] == n_active


def test_import_rejects_bad_file(client, auth):
    assert client.post("/api/v1/data/import", headers=auth,
                       json={"hello": 1}).status_code == 422


def test_backup_endpoint(client, auth):
    import os
    r = client.post("/api/v1/data/backup", headers=auth)
    assert r.status_code == 200
    path = r.json()["backup"]
    assert os.path.exists(path)
    assert os.path.getsize(path) > 0


def test_wipe_keeps_account(client, auth, admin):
    """销毁个人数据后账户仍可登录使用（R-data-05）。"""
    admin_id, _ = admin
    client.request("DELETE", "/api/v1/data/wipe", headers=auth,
                   json={"confirm": "清空"})
    assert client.get("/api/v1/identity/me", headers=auth).status_code == 200
