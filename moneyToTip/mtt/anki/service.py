"""anki 导入核心逻辑（需求 §5.10，D3/D5/D6）。

- TSV/CSV 纯文本导入（R-anki-02）：解析 #separator / #deck / #notetype 头
- .apkg 导入（R-anki-01）：zip → collection.anki21（SQLite）或 collection.anki21b（zstd）
- 牌组 `::` 层级 → 分类树（R-anki-04 / D6）
- 进度粗略迁移（R-anki-05）：ivl > 21 天 → 已掌握；学习中 → 巩固中；新卡 → 新学
- 导入报告（R-anki-06）：题数、去重、丢弃原因、图片数、进度映射
- 服务端执行（R-anki-09），客户端只上传文件并查看报告

v1 边界：HTML 卡片转纯文本（保留换行）；图片计数但不搬入（TODO(anki): 媒体入库）。
"""

import html
import json
import re
import sqlite3
import zipfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from sqlmodel import Session, select

from mtt.corpus.models import Category, Question, QuestionBank
from mtt.corpus.service import create_question, resolve_category_path
from mtt.schedule.models import QuestionState

CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)((?:::.*?))?\}\}")


@dataclass
class AnkiNote:
    stem: str
    answer: str
    deck: str = ""           # 完整牌组名，可含 ::
    tags: list[str] = field(default_factory=list)
    ivl: int = 0             # 天
    card_type: int = 0       # 0 新卡 1 学习中 2 已复习 3 重学
    has_media: bool = False


@dataclass
class ImportReport:
    bank: str = ""
    questions_created: int = 0
    duplicates_skipped: int = 0
    dropped_empty: int = 0
    media_refs_skipped: int = 0
    categories_created: int = 0
    progress_mastered: int = 0
    progress_learning: int = 0
    progress_new: int = 0
    decks: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "bank": self.bank,
            "questions_created": self.questions_created,
            "duplicates_skipped": self.duplicates_skipped,
            "dropped_empty": self.dropped_empty,
            "media_refs_skipped": self.media_refs_skipped,
            "categories_created": self.categories_created,
            "progress": {"mastered": self.progress_mastered,
                         "learning": self.progress_learning,
                         "new": self.progress_new},
            "decks": sorted(set(self.decks)),
        }


# ---------------- 文本处理 ----------------

def html_to_text(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(div|p|li|tr|h\d)\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<li[^>]*>", "· ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def _has_media(text: str) -> bool:
    return bool(re.search(r"<img\s|src=[\"']", text))


# ---------------- TSV / CSV ----------------

def parse_tsv(text: str) -> list[AnkiNote]:
    """Anki 导出「Notes in Plain Text」格式（R-anki-02）。"""
    notes: list[AnkiNote] = []
    sep = "\t"
    deck = ""
    for line in text.splitlines():
        if line.startswith("#separator:"):
            sep = "," if "comma" in line else "\t"
        elif line.startswith("#deck:"):
            deck = line[len("#deck:"):].strip()
        elif line.startswith("#"):
            continue
        elif line.strip():
            parts = line.split(sep)
            stem = html_to_text(parts[0])
            answer = html_to_text(parts[1]) if len(parts) > 1 else ""
            tags = parts[2].split() if len(parts) > 2 else []
            notes.append(AnkiNote(stem=stem, answer=answer, deck=deck,
                                  tags=tags, has_media=_has_media(line)))
    return notes


# ---------------- .apkg ----------------

def _open_collection(path: Path) -> sqlite3.Connection:
    """从 .apkg zip 中取出 collection 数据库连接（anki21 或 anki21b）。"""
    tmp = None
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if "collection.anki21" in names:
                data = zf.read("collection.anki21")
            elif "collection.anki21b" in names:
                import zstandard
                dctx = zstandard.ZstdDecompressor()
                data = dctx.decompress(zf.read("collection.anki21b"),
                                       max_output_size=512 * 1024 * 1024)
            else:
                raise ValueError("压缩包中没有 collection.anki21/anki21b")
    except zipfile.BadZipFile:
        raise ValueError("不是有效的 .apkg 文件（应为 zip）")
    tmp = path.parent / (path.stem + ".collection.tmp")
    tmp.write_bytes(data)
    return sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)


def parse_apkg(path: Path) -> list[AnkiNote]:
    conn = _open_collection(path)
    try:
        col = conn.execute("SELECT decks, models FROM col WHERE id = 1").fetchone()
        if col is None:
            raise ValueError("collection 数据库缺少 col 表")
        decks = {int(k): v.get("name", k) for k, v in json.loads(col[0]).items()}
        models = json.loads(col[1])

        notes: dict[int, AnkiNote] = {}
        for nid, mid, tags, flds in conn.execute(
                "SELECT id, mid, tags, flds FROM notes"):
            model = models.get(str(mid)) or {}
            fields = flds.split("\x1f")
            raw = "\x1f".join(fields)
            is_cloze = model.get("type") == 1
            if is_cloze:
                text = html_to_text(fields[0] if fields else "")
                answers = [m[0] for m in CLOZE_RE.findall(raw)]
                stem = CLOZE_RE.sub("[...]", text)
                answer = "、".join(answers)
            else:
                stem = html_to_text(fields[0]) if fields else ""
                answer = html_to_text("\n\n".join(fields[1:])) if len(fields) > 1 else ""
            notes[nid] = AnkiNote(
                stem=stem, answer=answer,
                tags=[t for t in (tags or "").split() if t],
                has_media=_has_media(raw))

        # 只取每张 note 的第一张卡（ord=0），并读牌组与进度
        for nid, did, ord_, ctype, ivl in conn.execute(
                "SELECT nid, did, ord, type, ivl FROM cards"):
            if ord_ != 0 or nid not in notes:
                continue
            note = notes[nid]
            note.deck = decks.get(int(did), str(did))
            note.card_type = ctype
            note.ivl = max(0, ivl)
        return list(notes.values())
    finally:
        conn.close()


# ---------------- 入库 ----------------

def import_notes(session: Session, owner_id: int, notes: list[AnkiNote],
                 bank_name: str) -> ImportReport:
    report = ImportReport(bank=bank_name)
    bank = session.exec(select(QuestionBank).where(
        QuestionBank.owner_id == owner_id,
        QuestionBank.name == bank_name)).first()
    if bank is None:
        bank = QuestionBank(owner_id=owner_id, name=bank_name,
                            description="Anki 导入")
        session.add(bank)
        session.commit()
        session.refresh(bank)
    report.bank = bank.name

    existing = {
        (q.stem, q.answer)
        for q in session.exec(select(Question).where(Question.owner_id == owner_id)).all()
    }
    seen: set[tuple[str, str]] = set()
    categories_before = _category_count(session, owner_id)
    today = date.today()

    for n in notes:
        if not n.deck:  # 没有任何卡片的 note
            report.dropped_empty += 1
            continue
        if not n.stem:
            report.dropped_empty += 1
            continue
        if not n.answer:
            report.dropped_empty += 1
            continue
        sig = (n.stem, n.answer)
        if sig in existing or sig in seen:
            report.duplicates_skipped += 1
            continue
        seen.add(sig)
        if n.has_media:
            report.media_refs_skipped += 1

        category_id = (resolve_category_path(session, owner_id, n.deck)
                       if n.deck else None)
        q = create_question(
            session, owner_id=owner_id, stem=n.stem, answer=n.answer,
            qtype="qa",  # Anki 卡片为问答形式，走主观题自评流程
            explanation="", source=f"Anki:{n.deck}" if n.deck else "Anki",
            tags=n.tags, difficulty=3, category_id=category_id,
            status="active", bank_id=bank.id,  # 人工牌组直接入复习队列
        )
        report.questions_created += 1
        report.decks.append(n.deck)

        # 进度粗略迁移（R-anki-05）
        if n.card_type == 2 and n.ivl > 21:
            session.add(QuestionState(
                user_id=owner_id, question_id=q.id, status="mastered",
                interval_days=n.ivl, reps=1, due_date=today + timedelta(days=n.ivl)))
            report.progress_mastered += 1
        elif n.card_type in (1, 3) or (n.card_type == 2 and n.ivl > 0):
            ivl = max(1, n.ivl)
            session.add(QuestionState(
                user_id=owner_id, question_id=q.id, status="learning",
                interval_days=ivl, reps=1, due_date=today + timedelta(days=ivl)))
            report.progress_learning += 1
        else:
            report.progress_new += 1
    session.commit()

    report.categories_created = (_category_count(session, owner_id)
                                 - categories_before)
    return report


def _category_count(session: Session, owner_id: int) -> int:
    return len(session.exec(select(Category).where(
        Category.owner_id == owner_id)).all())
