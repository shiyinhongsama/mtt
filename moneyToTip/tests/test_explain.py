"""explain 验收：手动触发、上下文预置、变式题、求助记日志不改排期。"""

from datetime import date, timedelta

from sqlmodel import Session, func, select

from mtt.db import engine as db_engine
from mtt.schedule.models import QuestionState, ReviewLog

from tests.conftest import get_state

FAKE_REPLY = "你错在把 volatile 当成原子性保证；它只保证可见性与禁止重排。"


def _patch_llm(monkeypatch, reply: str = FAKE_REPLY, variant: dict | None = None):
    from mtt.explain import service
    def fake_call(messages):
        if variant is not None:
            import json
            return json.dumps(variant, ensure_ascii=False)
        return reply
    monkeypatch.setattr(service, "call_llm", fake_call)


def test_ask_requires_existing_question(client, auth, monkeypatch):
    _patch_llm(monkeypatch)
    assert client.post("/api/v1/explain/ask", headers=auth,
                       json={"question_id": 999}).status_code == 404


def test_ask_logs_help_without_changing_schedule(client, auth, admin,
                                                 active_question, monkeypatch):
    """R-explain-07 + S-14：求助记日志、不算复习、排期不变、不计入今日已答。"""
    _patch_llm(monkeypatch)
    admin_id, _ = admin
    # 先答一次，建立排期
    client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "exp-1",
        "correct": True, "rating": "good"})
    before = get_state(admin_id, active_question.id)
    due_before = before.due_at
    reviewed_before = client.get("/api/v1/stats", headers=auth).json()["reviewed_today"]

    r = client.post("/api/v1/explain/ask", headers=auth, json={
        "question_id": active_question.id, "given": "80"})
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == FAKE_REPLY
    assert len(body["history"]) == 2

    # 排期不变
    after = get_state(admin_id, active_question.id)
    assert after.due_at == due_before

    # 日志有求助记录；今日已答不增加（求助不算复习）
    with Session(db_engine) as session:
        helps = session.exec(select(ReviewLog).where(
            ReviewLog.is_help_request == True)).all()  # noqa: E712
        assert len(helps) == 1
        assert helps[0].question_id == active_question.id
    stats = client.get("/api/v1/stats", headers=auth).json()
    assert stats["reviewed_today"] == reviewed_before


def test_ask_follow_up_keeps_history(client, auth, active_question, monkeypatch):
    """R-explain-03：追问携带上下文（history 回传）。"""
    _patch_llm(monkeypatch)
    r = client.post("/api/v1/explain/ask", headers=auth, json={
        "question_id": active_question.id, "given": ""})
    history = r.json()["history"]

    r = client.post("/api/v1/explain/ask", headers=auth, json={
        "question_id": active_question.id,
        "history": history,
        "mode": "chat"})
    assert r.status_code == 200
    assert len(r.json()["history"]) == 4


def test_ask_variant_mode(client, auth, active_question, monkeypatch):
    """R-explain-03：再出同类题 → 结构化变式。"""
    variant = {"stem": "变式题面", "options": None,
               "answer": "变式答案", "explanation": "变式讲解"}
    _patch_llm(monkeypatch, variant=variant)
    r = client.post("/api/v1/explain/ask", headers=auth, json={
        "question_id": active_question.id, "mode": "variant"})
    assert r.status_code == 200
    assert r.json()["variant"]["stem"] == "变式题面"


def test_ask_missing_key_gives_clear_error(client, auth, active_question,
                                           monkeypatch):
    from mtt.explain import service
    monkeypatch.setattr(service.settings, "model_api_key", "")
    r = client.post("/api/v1/explain/ask", headers=auth, json={
        "question_id": active_question.id})
    assert r.status_code == 400
    assert "MTT_MODEL_API_KEY" in r.json()["detail"]
