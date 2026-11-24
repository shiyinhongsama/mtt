import sqlite3
from datetime import datetime
from pathlib import Path

import mtt.db
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def _config(db: Path) -> Config:
    root = Path(__file__).parents[1]
    cfg = Config(str(root / "mtt" / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "mtt" / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db}")
    return cfg


def _create_legacy(db: Path, duplicate: bool = False) -> None:
    with sqlite3.connect(db) as conn:
        conn.executescript("""
            CREATE TABLE questionstate (
              id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              question_id INTEGER NOT NULL, status TEXT NOT NULL,
              interval_days INTEGER NOT NULL, reps INTEGER NOT NULL,
              due_date TEXT NOT NULL
            );
            CREATE TABLE reviewlog (
              id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
              question_id INTEGER NOT NULL, client_id TEXT NOT NULL,
              correct BOOLEAN NOT NULL, rating TEXT NOT NULL,
              duration_ms INTEGER NOT NULL, is_help_request BOOLEAN NOT NULL,
              reviewed_at DATETIME NOT NULL
            );
        """)
        conn.execute("INSERT INTO questionstate VALUES (1,1,9,'mastered',7,3,'2026-11-25')")
        if duplicate:
            conn.execute("INSERT INTO questionstate VALUES (2,1,9,'learning',3,4,'2026-11-24')")


def test_legacy_state_gains_memory_fields(tmp_path: Path):
    db = tmp_path / "legacy.db"
    _create_legacy(db)
    cfg = _config(db)
    command.stamp(cfg, "0001_baseline")
    command.upgrade(cfg, "head")
    with sqlite3.connect(db) as conn:
        row = conn.execute("""SELECT status, interval_minutes, reps, stability_days,
                              due_at, algorithm_version FROM questionstate""").fetchone()
    assert row[:3] == ("review", 10080, 3)
    assert row[3] > 0 and row[4] is not None
    assert datetime.fromisoformat(row[4]).utcoffset() is not None
    assert row[5] == "ebbinghaus-v1"
    indexes = inspect(create_engine(f"sqlite:///{db}")).get_indexes("questionstate")
    assert any(i["unique"] and set(i["column_names"]) == {"user_id", "question_id"}
               for i in indexes)


def test_migration_deduplicates_states(tmp_path: Path):
    db = tmp_path / "duplicates.db"
    _create_legacy(db, duplicate=True)
    cfg = _config(db)
    command.stamp(cfg, "0001_baseline")
    command.upgrade(cfg, "head")
    with sqlite3.connect(db) as conn:
        rows = conn.execute("SELECT id FROM questionstate").fetchall()
    assert rows == [(2,)]


def test_fresh_install_uses_current_schema(tmp_path: Path, monkeypatch):
    db = tmp_path / "fresh.db"
    monkeypatch.setattr(mtt.db, "engine", create_engine(f"sqlite:///{db}"))
    mtt.db.run_migrations()
    columns = {c["name"] for c in inspect(mtt.db.engine).get_columns("questionstate")}
    assert {"due_at", "stability_days", "interval_minutes", "algorithm_version"} <= columns
    assert "due_date" not in columns
