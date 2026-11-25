"""今日学习与真实历史耗时聚合。"""

from sqlmodel import Session

from mtt.corpus.service import create_question
from mtt.db import engine
from mtt.schedule.models import ReviewLog
from mtt.timeutil import utcnow


def _user(client, auth, username: str) -> tuple[int, dict[str, str]]:
    result = client.post("/api/v1/identity/users", headers=auth, json={
        "username": username, "password": "pw", "role": "user"}).json()
    return result["id"], {"Authorization": f"Bearer {result['token']}"}


def test_today_counts_distinct_questions_and_reports_shortage(client, auth):
    user_id, user_auth = _user(client, auth, "today-shortage-user")
    plan = client.post("/api/v1/plans", headers=user_auth, json={
        "name": "三题目标", "daily_goal": 3}).json()
    assert client.put("/api/v1/plans/active", headers=user_auth,
                      json={"plan_ids": [plan["id"]]}).status_code == 200
    first = client.post("/api/v1/questions", headers=user_auth, json={
        "stem": "今日唯一题", "answer": "a", "status": "active"}).json()
    client.post("/api/v1/questions", headers=user_auth, json={
        "stem": "今日待学新题", "answer": "b", "status": "active"})
    for client_id, rating in (("today-first", "good"), ("today-relearn", "again")):
        response = client.post("/api/v1/reviews", headers=user_auth, json={
            "question_id": first["id"], "client_id": client_id,
            "correct": rating != "again", "rating": rating, "plan_id": plan["id"]})
        assert response.status_code == 201

    result = client.get("/api/v1/stats/today", headers=user_auth)
    assert result.status_code == 200
    today = result.json()
    assert today["completed_count"] == 1
    assert today["goal_count"] == 3
    assert today["new_count"] == 1
    assert today["due_count"] == 1
    assert today["relearning_count"] == 1
    assert today["goal_met"] is False
    assert today["shortage_reason"] == "not_enough_due_questions"
    assert today["estimated_minutes"] is None
    assert len(today["forecast"]) == 7
    assert sum(day["count"] for day in today["forecast"]) >= 1


def test_today_estimates_from_median_of_five_durations(client, auth):
    user_id, user_auth = _user(client, auth, "today-duration-user")
    with Session(engine) as session:
        questions = [create_question(session, user_id, f"耗時题 {index}", "答案",
                                     status="active") for index in range(5)]
        for index, (question, minutes) in enumerate(zip(questions, [1, 2, 3, 4, 5], strict=True)):
            session.add(ReviewLog(user_id=user_id, question_id=question.id,
                                  client_id=f"duration-{index}", duration_ms=minutes * 60_000,
                                  reviewed_at=utcnow()))
            session.commit()
            result = client.get("/api/v1/stats/today", headers=user_auth).json()
            assert result["estimated_minutes"] == (3 if index == 4 else None)


def test_retention_hides_percentage_below_twenty_reviews(client, auth):
    user_id, user_auth = _user(client, auth, "insights-small-sample-user")
    with Session(engine) as session:
        for index in range(19):
            question = create_question(session, user_id, f"小样本题 {index}", "答案", status="active")
            rating = "good" if index < 15 else "again"
            session.add(ReviewLog(user_id=user_id, question_id=question.id,
                                  client_id=f"small-insight-{index}", rating=rating,
                                  correct=rating != "again", reviewed_at=utcnow()))
        session.commit()

    response = client.get("/api/v1/stats/insights?days=30", headers=user_auth)

    assert response.status_code == 200
    assert response.json()["retention"] == {"recalled": 15, "total": 19, "rate": None}


def test_retention_excludes_help_and_counts_distinct_recovery(client, auth):
    from mtt.corpus.models import Category

    user_id, user_auth = _user(client, auth, "insights-recovery-user")
    with Session(engine) as session:
        category = Category(owner_id=user_id, name="薄弱网络")
        session.add(category)
        session.commit()
        session.refresh(category)
        category_id = category.id
        log_index = 0
        for question_index in range(18):
            question = create_question(session, user_id, f"恢复题 {question_index}", "答案",
                                       status="active", category_id=category.id)
            ratings = ["again", "good"] if question_index < 2 else (
                ["good"] if question_index < 16 else ["again"])
            for rating in ratings:
                session.add(ReviewLog(user_id=user_id, question_id=question.id,
                                      client_id=f"recovery-insight-{log_index}", rating=rating,
                                      correct=rating != "again", reviewed_at=utcnow()))
                log_index += 1
        session.add(ReviewLog(user_id=user_id, question_id=question.id,
                              client_id="recovery-help", rating="good", is_help_request=True,
                              reviewed_at=utcnow()))
        session.commit()

    result = client.get("/api/v1/stats/insights?days=30", headers=user_auth).json()

    assert result["retention"] == {"recalled": 16, "total": 20, "rate": 0.8}
    assert result["recovered_count"] == 2
    weak = next(item for item in result["weak_categories"] if item["category_id"] == category_id)
    assert weak["total"] == 20 and weak["recalled"] == 16 and weak["rate"] == 0.8
    assert "due_count" in weak and weak["name"] == "薄弱网络"
