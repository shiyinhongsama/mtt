"""Anki 导入验收：TSV 纯文本、.apkg（anki21 SQLite）、牌组层级、进度迁移、导入报告。"""

import json
import sqlite3
import zipfile

TSV_SAMPLE = """#separator:tab
#html:true
#deck:面试::Java::并发
#notetype:Basic
volatile能保证原子性吗？\t不能，只保证可见性与禁止重排\t并发 jmm
什么是 happens-before？\t定义跨线程可见性与有序性的规则\tjmm
<br>会被转成换行吗？\t会\t格式

#deck:面试::网络
TCP三次握手第二步？\tSYN+ACK\t网络 tcp
"""


def test_tsv_import(client, auth):
    r = client.post("/api/v1/anki/import", headers=auth,
                    files={"file": ("deck.txt", TSV_SAMPLE, "text/plain")})
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["questions_created"] == 4
    assert report["bank"].startswith("Anki：")
    assert set(report["decks"]) == {"面试::Java::并发", "面试::网络"}

    # 层级完整保留为分类树（D6/R-anki-04）
    tree = client.get("/api/v1/questions/categories/tree", headers=auth).json()
    root = next(c for c in tree if c["name"] == "面试")
    java = next(c for c in root["children"] if c["name"] == "Java")
    assert java["children"][0]["name"] == "并发"

    # 题目入库：牌组作为出处，标签保留
    found = client.get("/api/v1/questions?status=active&q=volatile",
                       headers=auth).json()
    assert found["total"] == 1
    q = found["items"][0]
    assert q["qtype"] == "qa"
    assert q["source"] == "Anki:面试::Java::并发"
    assert "并发" in q["tags"]

    # HTML 换行转换
    found = client.get("/api/v1/questions?status=active&q=换行",
                       headers=auth).json()
    assert found["items"][0]["stem"] == "会被转成换行吗？"

    # 重复导入全部去重（S-12 精神）
    r = client.post("/api/v1/anki/import", headers=auth,
                    files={"file": ("deck.txt", TSV_SAMPLE, "text/plain")})
    assert r.json()["duplicates_skipped"] == 4
    assert r.json()["questions_created"] == 0


def _build_apkg(path):
    """构造最小 .apkg：col + notes + cards。"""
    db = path.parent / "collection.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE col (id integer primary key, decks text, models text);
        CREATE TABLE notes (id integer primary key, guid text, mid integer,
            mod integer, usn integer, tags text, flds text, sfld text,
            csum integer, flags integer, data text);
        CREATE TABLE cards (id integer primary key, nid integer, did integer,
            ord integer, mod integer, usn integer, type integer, queue integer,
            due integer, ivl integer, factor integer, reps integer,
            lapses integer, left integer, odue integer, odid integer,
            flags integer, data text);
    """)
    decks = {"1": {"name": "Default"}, "2": {"name": "医学::药理"}}
    models = {"10": {"name": "Basic", "type": 0,
                     "flds": [{"name": "Front"}, {"name": "Back"}]}}
    conn.execute("INSERT INTO col VALUES (1, ?, ?)",
                 (json.dumps(decks), json.dumps(models)))
    notes = [
        (1001, "g1", 10, 0, 0, "药理 常用药", "阿托品的临床用途？\x1f解除平滑肌痉挛、抑制腺体分泌等", "阿托品", 0, 0, ""),
        (1002, "g2", 10, 0, 0, "药理", "地塞米松属于哪类？\x1f糖皮质激素", "地塞米松", 0, 0, ""),
        (1003, "g3", 10, 0, 0, "", "", "空", 0, 0, ""),  # 空题应被丢弃
    ]
    conn.executemany("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", notes)
    cards = [
        (5001, 1001, 2, 0, 0, 0, 2, 0, 30, 30, 2500, 20, 1, 0, 0, 0, 0, ""),  # ivl>21 → 已掌握
        (5002, 1002, 2, 0, 0, 0, 2, 0, 10, 10, 2300, 8, 0, 0, 0, 0, 0, ""),   # ivl≤21 → 巩固中
    ]
    conn.executemany("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cards)
    conn.commit()
    conn.close()
    with zipfile.ZipFile(path, "w") as zf:
        zf.write(db, "collection.anki21")
        zf.writestr("media", "{}")
    db.unlink()


def test_apkg_import(client, auth, tmp_path):
    apkg = tmp_path / "medical.apkg"
    _build_apkg(apkg)
    r = client.post("/api/v1/anki/import", headers=auth,
                    files={"file": ("medical.apkg", apkg.read_bytes(),
                                    "application/octet-stream")})
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["questions_created"] == 2
    assert report["dropped_empty"] == 1
    assert report["progress"] == {"mastered": 1, "learning": 1, "new": 0}
    assert report["decks"] == ["医学::药理"]

    # 进度迁移可见：成熟知识量 +1（R-anki-05）
    stats = client.get("/api/v1/stats", headers=auth).json()
    assert stats["mature_count"] >= 1

    # 指定题库名
    r = client.post("/api/v1/anki/import?bank=医学牌组", headers=auth,
                    files={"file": ("medical.apkg", apkg.read_bytes(),
                                    "application/octet-stream")})
    assert r.json()["bank"] == "医学牌组"
    assert r.json()["questions_created"] == 0  # 全部重复


def test_anki_rejects_bad_file(client, auth):
    r = client.post("/api/v1/anki/import", headers=auth,
                    files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 422
    r = client.post("/api/v1/anki/import", headers=auth,
                    files={"file": ("x.apkg", b"not a zip", "application/octet-stream")})
    assert r.status_code == 422
