"""单个题库的导出与导入：内容往返、格式兼容、归属校验、去重与无效行报告。"""

import csv
import io
import json
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


def _import_file(client, auth, bank_id, filename, content):
    if isinstance(content, str):
        content = content.encode("utf-8")
    return client.post(f"/api/v1/questions/banks/{bank_id}/import", headers=auth,
                       files={"file": (filename, content)})


def test_import_csv_round_trip_recreates_content_and_categories(client, auth):
    source_bank = _bank(client, auth, "CSV 来源")
    parent = _category(client, auth, "语言")
    child = _category(client, auth, "Python", parent_id=parent["id"])
    _question(client, auth, source_bank["id"], "哪一个不可变？", qtype="choice",
              options=["list", "tuple"], answer="tuple", category_id=child["id"],
              explanation="tuple 不可变", source="types.md", tags=["Python"], difficulty=2)
    exported = client.get(f"/api/v1/questions/banks/{source_bank['id']}/export?format=csv",
                          headers=auth).content
    target = _bank(client, auth, "CSV 目标")

    r = _import_file(client, auth, target["id"], "roundtrip.csv", exported)
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["bank"] == "CSV 目标"
    assert report["created"] == 1
    assert report["duplicates"] == 0
    assert report["by_status"] == {"active": 1}
    assert report["invalid"] == [] and report["needs_review"] == []
    assert report["truncated"] is False

    items = _bank_questions(client, auth, target["id"])
    assert len(items) == 1
    imported = items[0]
    assert imported["qtype"] == "choice"
    assert imported["options"] == ["list", "tuple"]
    assert imported["answer"] == "tuple"
    assert imported["explanation"] == "tuple 不可变"
    assert imported["source"] == "types.md"
    assert imported["tags"] == ["Python"] and imported["difficulty"] == 2
    assert imported["status"] == "active"
    tree = client.get("/api/v1/questions/categories/tree", headers=auth).json()
    language = next(node for node in tree if node["name"] == "语言")
    assert language["children"][0]["id"] == imported["category_id"]

    # 同一文件再导入同一题库，全部去重，不产生第二份
    replay = _import_file(client, auth, target["id"], "roundtrip.csv", exported).json()
    assert replay["created"] == 0 and replay["duplicates"] == 1
    assert len(_bank_questions(client, auth, target["id"])) == 1


def test_import_json_array_and_bank_export(client, auth):
    target = _bank(client, auth, "JSON 目标")
    _question(client, auth, target["id"], "已有题", answer="已有答案")
    array = [
        {"stem": "新题一", "answer": "甲", "qtype": "choice", "options": ["甲", "乙"],
         "status": "active", "category": "JSON::基础", "source": "array.json"},
        {"stem": "已有题", "answer": "已有答案"},
        {"stem": "新题二", "answer": "答案二", "qtype": "qa"},
    ]
    r = _import_file(client, auth, target["id"], "questions.json", json.dumps(array, ensure_ascii=False))
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["created"] == 2 and report["duplicates"] == 1
    assert report["by_status"] == {"active": 1, "pending": 1}
    items = _bank_questions(client, auth, target["id"])
    by_stem = {item["stem"]: item for item in items}
    assert by_stem["新题一"]["category_id"] is not None
    assert by_stem["新题一"]["source"] == "array.json"
    assert by_stem["新题二"]["source"] == "导入：questions.json"
    assert by_stem["新题二"]["status"] == "pending"

    # 题库自己的 JSON 导出文件可直接导入另一个题库
    source = _bank(client, auth, "JSON 来源")
    _question(client, auth, source["id"], "从题库文件来", answer="答案", qtype="blank",
              category_id=None, status="active", source="bank.json")
    exported = client.get(f"/api/v1/questions/banks/{source['id']}/export", headers=auth).json()
    other = _bank(client, auth, "JSON 第二目标")
    r = _import_file(client, auth, other["id"], "bank.json",
                     json.dumps(exported, ensure_ascii=False))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    assert _bank_questions(client, auth, other["id"])[0]["stem"] == "从题库文件来"


def test_import_accepts_chinese_and_english_headers_and_tsv(client, auth):
    target = _bank(client, auth, "表头兼容")
    chinese = ("题面,答案,题型,选项,讲解,来源,标签,难度,分类,状态\n"
               "中文表头题,答案,问答,,中文讲解,,标签一 标签二,2,网络::基础,复习中\n")
    r = _import_file(client, auth, target["id"], "chinese.csv", chinese)
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    assert r.json()["by_status"] == {"active": 1}

    english = ("stem\tanswer\tqtype\toptions\texplanation\tsource\ttags\tdifficulty\tcategory\tstatus\n"
               "TSV 题\t甲\tchoice\t[\"甲\", \"乙\"]\t英文表头\tenglish.tsv\tone two\t1\tEnglish::TSV\tactive\n")
    r = _import_file(client, auth, target["id"], "english.tsv", english)
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    items = _bank_questions(client, auth, target["id"])
    by_stem = {item["stem"]: item for item in items}
    assert by_stem["中文表头题"]["qtype"] == "qa"
    assert by_stem["中文表头题"]["tags"] == ["标签一", "标签二"]
    assert by_stem["TSV 题"]["options"] == ["甲", "乙"]
    assert by_stem["TSV 题"]["status"] == "active"


def test_import_reports_invalid_duplicates_and_downgrades_unready_active_rows(client, auth):
    target = _bank(client, auth, "报告题库")
    _question(client, auth, target["id"], "库内重复", answer="答案")
    content = (
        "题面,答案,题型,选项,状态,来源\n"
        "库内重复,答案,问答,,复习中,test.md\n"
        "文件内重复,答案,问答,,待确认,test.md\n"
        "文件内重复,答案,问答,,待确认,test.md\n"
        ",缺题面,问答,,待确认,test.md\n"
        "缺答案,,问答,,待确认,test.md\n"
        "选择题答案不在选项里,不存在的选项,选择,\"甲\n乙\",复习中,test.md\n"
        "合法新题,答案,填空,,待确认,\n"
    )
    r = _import_file(client, auth, target["id"], "report.csv", content)
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["created"] == 3
    assert report["duplicates"] == 2
    assert report["by_status"] == {"pending": 3}
    assert len(report["invalid"]) == 2
    assert {item["reason"] for item in report["invalid"]} == {"缺少题面", "缺少答案"}
    assert len(report["needs_review"]) == 1
    assert report["needs_review"][0]["stem"] == "选择题答案不在选项里"
    assert "选择题答案必须是有效选项之一" in report["needs_review"][0]["reasons"]
    items = _bank_questions(client, auth, target["id"])
    by_stem = {item["stem"]: item for item in items}
    assert by_stem["选择题答案不在选项里"]["status"] == "pending"
    assert by_stem["合法新题"]["source"] == "导入：report.csv"


def test_import_rejects_unparseable_files_without_writing(client, auth):
    target = _bank(client, auth, "拒绝无效文件")
    for filename, content in [
        ("missing-header.csv", "只有题面\n没有表头\n"),
        ("empty.csv", ""),
        ("broken.json", "{not-json"),
        ("wrong.json", json.dumps({"format": "other", "questions": []})),
        ("wrong.xlsx", "题面,答案\n甲,乙\n"),
    ]:
        r = _import_file(client, auth, target["id"], filename, content)
        assert r.status_code == 422, (filename, r.status_code, r.text)
    assert _bank_questions(client, auth, target["id"]) == []
    assert _import_file(client, _other_auth(), target["id"], "a.csv", "题面,答案\n甲,乙\n").status_code == 404
