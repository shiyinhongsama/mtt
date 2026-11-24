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


def test_relearning_does_not_inflate_daily_goal(client, auth, active_question):
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "唯一题数", "bank_id": None, "daily_goal": 10}).json()
    for client_id, rating in (("first", "good"), ("relearn", "again")):
        response = client.post("/api/v1/reviews", headers=auth, json={
            "question_id": active_question.id, "client_id": client_id,
            "correct": rating != "again", "rating": rating,
            "plan_id": plan["id"]})
        assert response.status_code == 201
    current = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                   if p["id"] == plan["id"])
    assert current["today_done"] == plan["today_done"] + 1


def test_rejects_another_users_plan(client, auth, active_question):
    other = client.post("/api/v1/identity/users", headers=auth, json={
        "username": "other-plan-user", "password": "pw", "role": "user"}).json()
    other_auth = {"Authorization": f"Bearer {other['token']}"}
    plan = client.post("/api/v1/plans", headers=other_auth, json={
        "name": "他人计划", "daily_goal": 5}).json()
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "wrong-plan-owner",
        "correct": True, "rating": "good", "plan_id": plan["id"]})
    assert r.status_code == 404


def test_rejects_question_outside_plan_bank(client, auth, active_question):
    bank = client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "其他题库", "description": ""}).json()
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "限定题库", "bank_id": bank["id"], "daily_goal": 5}).json()
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "wrong-plan-bank",
        "correct": True, "rating": "good", "plan_id": plan["id"]})
    assert r.status_code == 409


def test_legacy_log_uses_bank_scope(client, auth, admin):
    from sqlmodel import Session

    from mtt.corpus.service import create_question
    from mtt.db import engine
    from mtt.schedule.models import ReviewLog
    from mtt.timeutil import utcnow

    user_id, _ = admin
    bank = client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "旧日志题库", "description": ""}).json()
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "旧日志计划", "bank_id": bank["id"], "daily_goal": 5}).json()
    with Session(engine) as session:
        q = create_question(session, user_id, "旧日志题", "答案",
                            status="active", bank_id=bank["id"])
        session.add(ReviewLog(user_id=user_id, question_id=q.id,
                              client_id="legacy-plan-log", rating="good",
                              reviewed_at=utcnow(), plan_id=None))
        session.commit()
    current = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                   if p["id"] == plan["id"])
    assert current["today_done"] == 1
