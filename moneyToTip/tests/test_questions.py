"""题库批量确认、编辑校验与学习历史删除保护。"""

from sqlmodel import Session

from mtt.corpus.service import create_question
from mtt.db import engine


def test_delete_question_with_history_requires_suspend(client, auth, active_question):
    reviewed = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "delete-history-guard",
        "correct": True, "rating": "good"})
    assert reviewed.status_code == 201

    response = client.delete(f"/api/v1/questions/{active_question.id}", headers=auth)

    assert response.status_code == 409
    assert "suspend" in response.json()["detail"]
    assert client.get(f"/api/v1/questions/{active_question.id}", headers=auth).status_code == 200


def test_bulk_confirm_keeps_invalid_items_pending(client, auth, admin):
    user_id, _ = admin
    with Session(engine) as session:
        valid = create_question(session, user_id, "有效待确认题", "答案", qtype="blank",
                                source="test.md", status="pending")
        invalid = create_question(session, user_id, "缺答案待确认题", "", qtype="blank",
                                  source="test.md", status="pending")
        valid_id, invalid_id = valid.id, invalid.id

    response = client.post("/api/v1/questions/bulk-confirm", headers=auth,
                           json={"ids": [valid_id, invalid_id]})

    assert response.status_code == 200
    assert response.json()["confirmed_ids"] == [valid_id]
    assert response.json()["failures"] == [{"id": invalid_id, "reason": "答案不能为空"}]
    assert client.get(f"/api/v1/questions/{valid_id}", headers=auth).json()["status"] == "active"
    assert client.get(f"/api/v1/questions/{invalid_id}", headers=auth).json()["status"] == "pending"


def test_update_rejects_invalid_question(client, auth):
    question = client.post("/api/v1/questions", headers=auth, json={
        "stem": "原题面", "answer": "原答案", "qtype": "blank", "source": "test.md"}).json()

    response = client.patch(f"/api/v1/questions/{question['id']}", headers=auth,
                            json={"answer": "  "})

    assert response.status_code == 422
    assert response.json()["detail"] == "答案不能为空"
    assert client.get(f"/api/v1/questions/{question['id']}", headers=auth).json()["answer"] == "原答案"
