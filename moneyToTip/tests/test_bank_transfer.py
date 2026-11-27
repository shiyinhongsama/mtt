"""单个题库的导出与导入：内容往返、格式兼容、归属校验、去重与无效行报告。"""

import csv
import io
import secrets

from sqlmodel import Session

from mtt.db import engine
from mtt.identity.service import create_user


def _bank(client, auth, name):
    r = client.post("/api/v1/questions/banks", headers=auth, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _question(client, auth, bank_id, stem, **fields):
    payload = {"stem": stem, "answer": "答案", "qtype": "qa", "bank_id": bank_id,
               "status": "active", "source": "test.md"}
    payload.update(fields)
    r = client.post("/api/v1/questions", headers=auth, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _category(client, auth, name, parent_id=None):
    r = client.post("/api/v1/questions/categories", headers=auth,
                    json={"name": name, "parent_id": parent_id})
    assert r.status_code == 201, r.text
    return r.json()


def _other_auth():
    """第二个普通用户的请求头，用来验证归属校验。"""
    with Session(engine) as session:
        _, token = create_user(session, f"other-{secrets.token_hex(3)}", password="pw", role="user")
    return {"Authorization": f"Bearer {token}"}


def _bank_questions(client, auth, bank_id):
    r = client.get(f"/api/v1/questions?status=&bank_id={bank_id}&page_size=100", headers=auth)
    return r.json()["items"]


def test_export_json_contains_only_that_bank_with_category_paths(client, auth):
    bank = _bank(client, auth, "导出题库")
    other_bank = _bank(client, auth, "别的题库")
    parent = _category(client, auth, "Python")
    child = _category(client, auth, "数据与类型", parent_id=parent["id"])
    _question(client, auth, bank["id"], "tuple 可以原地修改吗？", qtype="choice",
              options=["可以", "不可以"], answer="不可以", category_id=child["id"],
              tags=["Python", "数据类型"], difficulty=2, status="pending", explanation="元组不可变")
    _question(client, auth, bank["id"], "没有分类的题")
    _question(client, auth, other_bank["id"], "别的题库里的题")

    r = client.get(f"/api/v1/questions/banks/{bank['id']}/export", headers=auth)
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    data = r.json()
    assert data["format"] == "moneytotip-bank"
    assert data["version"] == 1
    assert data["bank"]["name"] == "导出题库"
    # 只搬运题目内容，不带学习进度
    assert "states" not in data and "review_logs" not in data
    assert [q["stem"] for q in data["questions"]] == ["tuple 可以原地修改吗？", "没有分类的题"]
    first = data["questions"][0]
    assert first["category"] == "Python::数据与类型"
    assert first["qtype"] == "choice" and first["options"] == ["可以", "不可以"]
    assert first["answer"] == "不可以" and first["status"] == "pending"
    assert first["tags"] == ["Python", "数据类型"] and first["difficulty"] == 2
    assert first["explanation"] == "元组不可变"
    assert data["questions"][1]["category"] is None

    # 别人的题库不可导出
    assert client.get(f"/api/v1/questions/banks/{bank['id']}/export",
                      headers=_other_auth()).status_code == 404


def test_export_csv_uses_labels_and_one_option_per_line(client, auth):
    bank = _bank(client, auth, "表格题库")
    parent = _category(client, auth, "网络")
    child = _category(client, auth, "HTTP", parent_id=parent["id"])
    _question(client, auth, bank["id"], "HTTP 默认端口是？", qtype="choice",
              options=["80, 或 443", "21"], answer="80, 或 443", category_id=child["id"],
              tags=["网络", "HTTP"], status="active", explanation="带逗号, 的讲解")
    _question(client, auth, bank["id"], "纯文本题", qtype="qa", status="pending", source="")

    r = client.get(f"/api/v1/questions/banks/{bank['id']}/export?format=csv", headers=auth)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.content.startswith(b"\xef\xbb\xbf")  # BOM：表格软件直接打开不乱码
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert list(rows[0].keys()) == ["题面", "答案", "题型", "选项", "讲解", "来源", "标签", "难度", "分类", "状态"]
    assert rows[0]["题面"] == "HTTP 默认端口是？"
    assert rows[0]["答案"] == "80, 或 443"
    assert rows[0]["选项"] == "80, 或 443\n21"
    assert rows[0]["讲解"] == "带逗号, 的讲解"
    assert rows[0]["题型"] == "选择" and rows[0]["状态"] == "复习中"
    assert rows[0]["分类"] == "网络::HTTP" and rows[0]["标签"] == "网络 HTTP"
    assert rows[0]["难度"] == "3"
    assert rows[1]["题型"] == "问答" and rows[1]["状态"] == "待确认" and rows[1]["分类"] == ""
