"""训练计划验收：CRUD、题库范围进度、目标达成判定。"""


def test_plan_crud(client, auth):
    r = client.post("/api/v1/plans", headers=auth, json={
        "name": "每日十题", "daily_goal": 10})
    assert r.status_code == 201
    plan = r.json()
    assert plan["daily_goal"] == 10 and "today_done" in plan

    pid = plan["id"]
    r = client.patch(f"/api/v1/plans/{pid}", headers=auth, json={
        "name": "每日五题", "daily_goal": 5})
    assert r.json()["daily_goal"] == 5

    plans = client.get("/api/v1/plans", headers=auth).json()
    mine = [p for p in plans if p["name"] == "每日五题"]
    assert len(mine) == 1

    assert client.delete(f"/api/v1/plans/{pid}", headers=auth).status_code == 200
    assert all(p["id"] != pid for p in client.get("/api/v1/plans", headers=auth).json())


def test_plan_validation(client, auth):
    assert client.post("/api/v1/plans", headers=auth, json={
        "name": "x", "daily_goal": 0}).status_code == 422
    # 别人的题库不可用
    assert client.post("/api/v1/plans", headers=auth, json={
        "name": "x", "bank_id": 999}).status_code == 404


def test_plan_progress_scoped_by_bank(client, auth, active_question):
    """计划进度按题库范围统计；达标判定驱动客户端加练流程。"""
    # 建一个题库 + 绑定该题库的计划
    bank = client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "计划题库"}).json()
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "题库特训", "bank_id": bank["id"], "daily_goal": 2}).json()

    # 默认题库答一题：不影响该计划进度
    client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "plan-1",
        "correct": True, "rating": "good"})
    plan = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                if p["id"] == plan["id"])
    assert plan["today_done"] == 0 and plan["goal_met"] is False

    # 计划题库内答两题 → 达成
    for i in range(2):
        q = client.post("/api/v1/questions", headers=auth, json={
            "stem": f"计划题{i}", "answer": "a", "bank_id": bank["id"],
            "status": "active"}).json()
        client.post("/api/v1/reviews", headers=auth, json={
            "question_id": q["id"], "client_id": f"plan-b-{i}",
            "correct": True, "rating": "good"})
    plan = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                if p["id"] == plan["id"])
    assert plan["today_done"] == 2 and plan["goal_met"] is True


def test_plan_all_banks_scope(client, auth, active_question):
    """bank_id 为空 = 全部题库。"""
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "全部", "daily_goal": 1}).json()
    client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "plan-all-1",
        "correct": True, "rating": "good"})
    plan = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                if p["name"] == "全部")
    assert plan["today_done"] >= 1 and plan["goal_met"] is True  # 全库口径，含其他用例的作答
