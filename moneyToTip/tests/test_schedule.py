"""复习引擎验收：分钟级排期、review log、幂等回写和记忆状态。"""

from datetime import UTC, datetime, timedelta

from sqlmodel import Session, func, select

from mtt.corpus.service import create_question
from mtt.db import engine as db_engine
from mtt.schedule.models import QuestionState, ReviewLog
from tests.conftest import get_state


def test_due_and_submit(client, auth, admin, active_question):
    admin_id, _ = admin

    r = client.get("/api/v1/reviews/due", headers=auth)
    assert r.status_code == 200
    assert active_question.id in [q["id"] for q in r.json()]

    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id,
        "client_id": "req-001",
        "correct": True,
        "rating": "good",
        "duration_ms": 5000,
    })
    assert r.status_code == 201
    body = r.json()
    assert body["idempotent"] is False
    assert body["state"]["status"] == "learning"
    assert body["state"]["label"] == "学习中"
    assert body["state"]["due_at"] is not None

    state = get_state(admin_id, active_question.id)
    assert state.interval_minutes == 234
    assert state.due_at is not None

    r = client.get("/api/v1/reviews/due", headers=auth)
    assert active_question.id not in [q["id"] for q in r.json()]


def test_wrong_answer_comes_back_soon(client, auth, admin, active_question):
    admin_id, _ = admin
    client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id,
        "client_id": "req-wrong",
        "correct": False,
        "rating": "good",  # 答错强制按 again 处理
    })
    state = get_state(admin_id, active_question.id)
    assert state.interval_minutes == 10
    assert state.status == "relearning"


def test_idempotent_submit(client, auth, admin, active_question):
    """重发同一结果两次，日志仍只有一条（R-api-10）。"""
    payload = {
        "question_id": active_question.id,
        "client_id": "req-dup",
        "correct": True,
        "rating": "good",
    }
    assert client.post("/api/v1/reviews", headers=auth, json=payload).status_code == 201
    r = client.post("/api/v1/reviews", headers=auth, json=payload)
    assert r.status_code == 201
    assert r.json()["idempotent"] is True

    admin_id, _ = admin
    with Session(db_engine) as session:
        count = session.exec(
            select(func.count()).select_from(ReviewLog).where(ReviewLog.client_id == "req-dup")
        ).one()
    assert count == 1


def test_pending_question_not_in_due_queue(client, auth, admin):
    """预览区（pending）的题不进复习队列（R-generate-05）。"""
    admin_id, _ = admin
    with Session(db_engine) as session:
        q = create_question(session, owner_id=admin_id, stem="?", answer="!",
                            status="pending")
    with Session(db_engine) as session:
        session.add(QuestionState(user_id=admin_id, question_id=q.id))
        session.commit()
    r = client.get("/api/v1/reviews/due", headers=auth)
    assert q.id not in [item["id"] for item in r.json()]


def test_stats_mature_count(client, auth, admin, active_question):
    """成熟知识量：稳定复习且间隔达到 21 天（R-growth-01）。"""
    admin_id, _ = admin
    with Session(db_engine) as session:
        session.add(QuestionState(
            user_id=admin_id, question_id=active_question.id,
            status="review", interval_minutes=30 * 1440,
            due_at=datetime.now(UTC) + timedelta(days=30),
        ))
        session.commit()

    r = client.get("/api/v1/stats", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["mature_count"] == 1
    assert body["active_questions"] >= 1


def test_due_filtered_by_category(client, auth, admin):
    """按分类刷题：选父分类包含后代分类的题；未分类题被排除（R-growth-04 前置）。"""
    from mtt.corpus.service import resolve_category_path

    admin_id, _ = admin
    with Session(db_engine) as session:
        root = resolve_category_path(session, admin_id, "后端::数据库")
        leaf = resolve_category_path(session, admin_id, "后端::数据库::MySQL")
        other = resolve_category_path(session, admin_id, "前端")
        q_root = create_question(session, owner_id=admin_id, stem="R", answer="R",
                                 status="active", category_id=root)
        q_leaf = create_question(session, owner_id=admin_id, stem="L", answer="L",
                                 status="active", category_id=leaf)
        q_other = create_question(session, owner_id=admin_id, stem="O", answer="O",
                                  status="active", category_id=other)
        q_none = create_question(session, owner_id=admin_id, stem="N", answer="N",
                                 status="active")
        ids = (q_root.id, q_leaf.id, q_other.id, q_none.id)

    r = client.get("/api/v1/reviews/due", headers=auth)
    due_all = {q["id"] for q in r.json()}
    assert set(ids) <= due_all

    r = client.get(f"/api/v1/reviews/due?category_id={root}", headers=auth)
    due = {q["id"] for q in r.json()}
    assert ids[0] in due and ids[1] in due
    assert ids[2] not in due and ids[3] not in due

    r = client.get(f"/api/v1/reviews/due?category_id={root}", headers={
        "Authorization": "Bearer x"})
    assert r.status_code == 401


def test_review_returns_memory_decision(client, auth, active_question):
    payload = {"question_id": active_question.id, "client_id": "memory-1",
               "correct": True, "rating": "good", "duration_ms": 1200}
    r = client.post("/api/v1/reviews", headers=auth, json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["decision"]["algorithm_version"] == "ebbinghaus-v1"
    assert body["decision"]["interval_minutes"] > 0
    assert body["state"]["due_at"] is not None


def test_replay_does_not_advance_schedule(client, auth, active_question):
    payload = {"question_id": active_question.id, "client_id": "memory-replay",
               "correct": True, "rating": "good"}
    first = client.post("/api/v1/reviews", headers=auth, json=payload).json()
    second = client.post("/api/v1/reviews", headers=auth, json=payload).json()
    assert second["idempotent"] is True
    assert second["log_id"] == first["log_id"]
    assert second["decision"] == first["decision"]


def test_unknown_rating_is_rejected(client, auth, active_question):
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "bad-rating",
        "correct": True, "rating": "perfect"})
    assert r.status_code == 422


def test_negative_duration_is_rejected(client, auth, active_question):
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "bad-duration",
        "correct": True, "rating": "good", "duration_ms": -1})
    assert r.status_code == 422


def test_concurrent_replay_writes_one_log_and_one_rep(client, auth, active_question):
    from concurrent.futures import ThreadPoolExecutor

    payload = {"question_id": active_question.id, "client_id": "concurrent-replay",
               "correct": True, "rating": "good"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(
            lambda _: client.post("/api/v1/reviews", headers=auth, json=payload),
            range(2),
        ))
    assert [r.status_code for r in responses] == [201, 201]
    assert len({r.json()["log_id"] for r in responses}) == 1
    exported = client.get("/api/v1/data/export", headers=auth).json()
    logs = [x for x in exported["review_logs"] if x["client_id"] == "concurrent-replay"]
    states = [x for x in exported["states"] if x["question_id"] == active_question.id]
    assert len(logs) == 1
    assert len(states) == 1 and states[0]["reps"] == 1


def test_due_queue_uses_due_at_and_previews(client, auth, active_question):
    r = client.get("/api/v1/reviews/due", headers=auth)
    assert r.status_code == 200
    item = next(q for q in r.json() if q["id"] == active_question.id)
    assert set(item["rating_previews"]) == {"again", "hard", "good", "easy"}
    assert item["rating_previews"]["again"]["interval_minutes"] == 10


def test_future_minutes_are_not_due(client, auth, active_question):
    submitted = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "future-minutes",
        "correct": True, "rating": "good"})
    assert submitted.status_code == 201
    due = client.get("/api/v1/reviews/due", headers=auth).json()
    assert active_question.id not in {q["id"] for q in due}


def test_due_queue_orders_by_due_at(client, auth, admin):
    user_id, _ = admin
    now = datetime.now(UTC)
    with Session(db_engine) as session:
        later = create_question(session, user_id, "后到期", "B", status="active")
        earlier = create_question(session, user_id, "先到期", "A", status="active")
        session.add(QuestionState(user_id=user_id, question_id=later.id,
                                  status="review", due_at=now - timedelta(minutes=5)))
        session.add(QuestionState(user_id=user_id, question_id=earlier.id,
                                  status="review", due_at=now - timedelta(hours=1)))
        session.commit()
        later_id, earlier_id = later.id, earlier.id
    due = client.get("/api/v1/reviews/due", headers=auth).json()
    ids = [q["id"] for q in due]
    assert ids.index(earlier_id) < ids.index(later_id)


def test_due_limit_is_bounded(client, auth):
    assert client.get("/api/v1/reviews/due?limit=0", headers=auth).status_code == 422
    assert client.get("/api/v1/reviews/due?limit=101", headers=auth).status_code == 422
