"""复习引擎验收：排期规则、review log、幂等回写、三档状态。"""

from datetime import date, timedelta

from mtt.schedule import engine
from mtt.schedule.models import QuestionState, ReviewLog
from sqlmodel import Session, func, select

from mtt.db import engine as db_engine

from tests.conftest import get_state


def test_next_interval_rules():
    """答错的题更早再次出现（R-schedule-03）。"""
    assert engine.next_interval(10, "again") == 1
    assert engine.next_interval(10, "hard") == 15
    assert engine.next_interval(10, "good") == 20
    assert engine.next_interval(10, "easy") == 25


def test_status_thresholds():
    assert engine.status_for(0) == "new"
    assert engine.status_for(7) == "learning"
    assert engine.status_for(22) == "mastered"


def test_due_and_submit(client, auth, admin, active_question):
    admin_id, _ = admin

    # 新题今天到期（due_date 默认今天）
    r = client.get("/api/v1/reviews/due", headers=auth)
    assert r.status_code == 200
    ids = [q["id"] for q in r.json()]
    assert active_question.id in ids

    # 答对（good）→ 间隔 ×2 → 明天到期，今天不再出现
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
    assert body["state"] == {"status": "learning", "label": "巩固中"}

    state = get_state(admin_id, active_question.id)
    assert state.interval_days == 1
    assert state.due_date == date.today() + timedelta(days=1)

    r = client.get("/api/v1/reviews/due", headers=auth)
    assert active_question.id not in [q["id"] for q in r.json()]


def test_wrong_answer_comes_back_soon(client, auth, admin, active_question):
    admin_id, _ = admin
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id,
        "client_id": "req-wrong",
        "correct": False,
        "rating": "good",  # 答错强制按 again 处理
    })
    state = get_state(admin_id, active_question.id)
    assert state.interval_days == 1  # 答错 → 1 天后再次出现


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
    from mtt.corpus.service import create_question
    admin_id, _ = admin
    with Session(db_engine) as session:
        q = create_question(session, owner_id=admin_id, stem="?", answer="!",
                            status="pending")
    # 手工构造到期状态
    with Session(db_engine) as session:
        session.add(QuestionState(user_id=admin_id, question_id=q.id))
        session.commit()
    r = client.get("/api/v1/reviews/due", headers=auth)
    assert q.id not in [item["id"] for item in r.json()]


def test_stats_mature_count(client, auth, admin, active_question):
    """成熟知识量：间隔 > 21 天（R-growth-01）。"""
    admin_id, _ = admin
    with Session(db_engine) as session:
        session.add(QuestionState(
            user_id=admin_id, question_id=active_question.id,
            status="mastered", interval_days=30,
            due_date=date.today() + timedelta(days=30),
        ))
        session.commit()

    r = client.get("/api/v1/stats", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["mature_count"] == 1
    assert body["active_questions"] >= 1  # active_question fixture 每测试一道


def test_due_filtered_by_category(client, auth, admin):
    """按分类刷题：选父分类包含后代分类的题；未分类题被排除（R-growth-04 前置）。"""
    from mtt.corpus.service import create_question, resolve_category_path
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

    # 全部：都在
    r = client.get("/api/v1/reviews/due", headers=auth)
    due_all = {q["id"] for q in r.json()}
    assert set(ids) <= due_all

    # 选「后端」：根+叶在内，其他分类与未分类排除
    r = client.get(f"/api/v1/reviews/due?category_id={root}", headers=auth)
    due = {q["id"] for q in r.json()}
    assert ids[0] in due and ids[1] in due
    assert ids[2] not in due and ids[3] not in due

    # 别人的分类不可用
    r = client.get(f"/api/v1/reviews/due?category_id={root}", headers={
        "Authorization": "Bearer x"})
    assert r.status_code == 401
