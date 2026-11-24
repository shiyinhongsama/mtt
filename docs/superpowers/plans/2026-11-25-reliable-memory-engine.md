# Reliable Review and Ebbinghaus Memory Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable, minute-level review API with personalized memory stability, short relearning, rating previews, accurate plan progress, and backward-compatible data migration.

**Architecture:** Keep the existing FastAPI/SQLModel modular monolith. Add a pure memory engine under `schedule`, persist its explicit state with Alembic migrations, and expose all scheduling decisions through the existing review endpoints; frontend redesign is handled by a separate plan.

**Tech Stack:** Python 3.12, FastAPI, SQLModel, SQLAlchemy, SQLite, Alembic, pytest.

## Global Constraints

- Backend package root is `moneyToTip/`; all commands in this plan run from that directory.
- Use `uv run --frozen pytest` after dependencies are locked; use `uv run pytest` only when intentionally updating the lockfile.
- Default target retention is exactly `0.85`; minimum interval is 10 minutes and maximum interval is 365 days.
- Ratings are exactly `again | hard | good | easy`; unknown ratings must return HTTP 422.
- Every displayed review decision comes from `mtt.schedule.memory`; no route may duplicate the formula.
- Existing `client_id` replay must return the original result without adding a log or advancing the schedule.
- Existing databases and version-1 exports must remain readable.
- No frontend visual redesign, FSRS, offline answering, Anki export, MCP, or native app work belongs to this plan.
- Each task uses RED → GREEN → regression verification. Commit steps are included for execution review checkpoints.

---

## File Structure

- Create `mtt/schedule/memory.py`: pure forgetting-curve calculations and rating decisions.
- Modify `mtt/schedule/models.py`: explicit memory state and optional review-log plan attribution.
- Create `mtt/alembic/`: Alembic environment and versioned SQLite migrations.
- Modify `mtt/db.py`: select fresh-install, legacy-upgrade, and normal-upgrade paths.
- Modify `mtt/schedule/router.py`: transactional idempotent writes, minute-level due queue, rating previews.
- Modify `mtt/schedule/plans.py`: distinct-question daily progress and plan ownership validation.
- Modify `mtt/data/service.py`: versioned export/import of the new state fields.
- Create `tests/test_memory.py`, `tests/test_migrations.py`: pure model and upgrade coverage.
- Modify `tests/test_schedule.py`, `tests/test_plans.py`, `tests/test_data.py`: behavior and compatibility coverage.

### Task 1: Pure Memory Engine

**Files:**
- Create: `mtt/schedule/memory.py`
- Create: `tests/test_memory.py`

**Interfaces:**
- Produces: `MemorySnapshot(reps: int, lapses: int, stability_days: float, interval_minutes: int)`.
- Produces: `MemoryDecision(stability_days: float, interval_minutes: int, due_at: datetime, status: str, algorithm_version: str)`.
- Produces: `decide(snapshot: MemorySnapshot, rating: Rating, now: datetime, target_retention: float = 0.85) -> MemoryDecision`.
- Produces: `preview(snapshot: MemorySnapshot, now: datetime) -> dict[str, dict[str, object]]`.

- [ ] **Step 1: Write failing deterministic tests**

```python
from datetime import UTC, datetime, timedelta
import math
import pytest

from mtt.schedule.memory import MemorySnapshot, decide, preview

NOW = datetime(2026, 11, 25, 0, 0, tzinfo=UTC)
NEW = MemorySnapshot(reps=0, lapses=0, stability_days=1.0, interval_minutes=0)


def test_new_good_uses_exponential_forgetting_curve():
    result = decide(NEW, "good", NOW)
    assert result.stability_days == 1.0
    assert result.interval_minutes == round(-24 * 60 * math.log(0.85))
    assert result.due_at == NOW + timedelta(minutes=result.interval_minutes)
    assert result.status == "learning"
    assert result.algorithm_version == "ebbinghaus-v1"


def test_again_enters_ten_minute_relearning():
    result = decide(NEW, "again", NOW)
    assert result.interval_minutes == 10
    assert result.due_at == NOW + timedelta(minutes=10)
    assert result.status == "relearning"


def test_success_updates_existing_stability():
    old = MemorySnapshot(reps=3, lapses=0, stability_days=4.0, interval_minutes=1000)
    assert decide(old, "hard", NOW).stability_days == pytest.approx(4.8)
    assert decide(old, "good", NOW).stability_days == pytest.approx(8.0)
    assert decide(old, "easy", NOW).stability_days == pytest.approx(11.2)


def test_interval_is_clamped_and_preview_does_not_mutate():
    old = MemorySnapshot(reps=8, lapses=0, stability_days=10_000.0, interval_minutes=1)
    result = decide(old, "easy", NOW)
    assert result.interval_minutes == 365 * 24 * 60
    before = preview(old, NOW)
    assert set(before) == {"again", "hard", "good", "easy"}
    assert old.stability_days == 10_000.0
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `uv run --frozen pytest tests/test_memory.py -q`
Expected: collection fails because `mtt.schedule.memory` does not exist.

- [ ] **Step 3: Implement the pure engine**

```python
"""Transparent Ebbinghaus-inspired exponential forgetting model."""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

Rating = Literal["again", "hard", "good", "easy"]
ALGORITHM_VERSION = "ebbinghaus-v1"
DEFAULT_TARGET_RETENTION = 0.85
MIN_INTERVAL_MINUTES = 10
MAX_INTERVAL_MINUTES = 365 * 24 * 60


@dataclass(frozen=True)
class MemorySnapshot:
    reps: int
    lapses: int
    stability_days: float
    interval_minutes: int


@dataclass(frozen=True)
class MemoryDecision:
    stability_days: float
    interval_minutes: int
    due_at: datetime
    status: str
    algorithm_version: str


def _interval(stability_days: float, target_retention: float) -> int:
    if not 0.5 <= target_retention <= 0.95:
        raise ValueError("target_retention must be between 0.5 and 0.95")
    minutes = round(-stability_days * 24 * 60 * math.log(target_retention))
    return min(MAX_INTERVAL_MINUTES, max(MIN_INTERVAL_MINUTES, minutes))


def decide(snapshot: MemorySnapshot, rating: Rating, now: datetime,
           target_retention: float = DEFAULT_TARGET_RETENTION) -> MemoryDecision:
    if rating == "again":
        stability = max(0.1, snapshot.stability_days * 0.5)
        minutes = MIN_INTERVAL_MINUTES
        status = "relearning"
    else:
        if snapshot.reps == 0:
            stability = {"hard": 0.5, "good": 1.0, "easy": 2.0}[rating]
        else:
            stability = snapshot.stability_days * {"hard": 1.2, "good": 2.0, "easy": 2.8}[rating]
        minutes = _interval(stability, target_retention)
        if rating == "hard":
            minutes = max(minutes, snapshot.interval_minutes)
        status = "learning" if snapshot.reps < 2 else "review"
    return MemoryDecision(stability, minutes, now + timedelta(minutes=minutes),
                          status, ALGORITHM_VERSION)


def preview(snapshot: MemorySnapshot, now: datetime) -> dict[str, dict[str, object]]:
    result = {}
    for rating in ("again", "hard", "good", "easy"):
        decision = decide(snapshot, rating, now)  # type: ignore[arg-type]
        result[rating] = {
            "interval_minutes": decision.interval_minutes,
            "due_at": decision.due_at,
            "status": decision.status,
        }
    return result
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `uv run --frozen pytest tests/test_memory.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add mtt/schedule/memory.py tests/test_memory.py
git commit -m "feat: add personalized memory engine"
```

### Task 2: Versioned Schema and Legacy Migration

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Modify: `mtt/schedule/models.py`
- Create: `mtt/alembic.ini`
- Create: `mtt/alembic/env.py`
- Create: `mtt/alembic/script.py.mako`
- Create: `mtt/alembic/versions/0001_baseline.py`
- Create: `mtt/alembic/versions/0002_memory_state.py`
- Modify: `mtt/db.py`
- Create: `tests/test_migrations.py`

**Interfaces:**
- `QuestionState` exposes `due_at`, `stability_days`, `interval_minutes`, `lapses`, `last_rating`, `last_reviewed_at`, `algorithm_version`.
- `ReviewLog` exposes optional `plan_id: int | None` plus `decision_due_at: datetime | None`, `decision_interval_minutes: int | None`, and `decision_algorithm_version: str`.
- Decision fields on `ReviewLog` are immutable snapshots used for exact idempotent responses and historical schedule explanations.
- Produces `run_migrations() -> None`; `init_db()` delegates to it after importing all models.

- [ ] **Step 1: Write failing fresh-install and legacy-upgrade tests**

```python
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
                              due_at, algorithm_version FROM questionstate""").one()
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
        rows = conn.execute("SELECT id FROM questionstate").all()
    assert rows == [(2,)]


def test_fresh_install_uses_current_schema(tmp_path: Path, monkeypatch):
    db = tmp_path / "fresh.db"
    monkeypatch.setattr(mtt.db, "engine", create_engine(f"sqlite:///{db}"))
    mtt.db.run_migrations()
    columns = {c["name"] for c in inspect(mtt.db.engine).get_columns("questionstate")}
    assert {"due_at", "stability_days", "interval_minutes", "algorithm_version"} <= columns
    assert "due_date" not in columns
```

- [ ] **Step 2: Run migration tests and verify RED**

Run: `uv run --frozen pytest tests/test_migrations.py -q`
Expected: FAIL because Alembic and the new fields are absent.

- [ ] **Step 3: Add Alembic and implement models/migrations**

Add `"alembic>=1.14"` to project dependencies, run `uv lock`, and configure Alembic with `render_as_batch=True` for SQLite. Use an empty `0001_baseline` revision. `0002_memory_state` must:

```python
# Column defaults used while backfilling existing rows:
# due_at: nullable during backfill, then non-null
# stability_days: Float, server_default='1'
# interval_minutes: Integer, server_default='0'
# lapses: Integer, server_default='0'
# last_rating: String, server_default=''
# last_reviewed_at: DateTime(timezone=True), nullable=True
# algorithm_version: String, server_default='ebbinghaus-v1'
# reviewlog.plan_id: Integer, nullable=True
# reviewlog.decision_due_at: DateTime(timezone=True), nullable=True
# reviewlog.decision_interval_minutes: Integer, nullable=True
# reviewlog.decision_algorithm_version: String, server_default=''
```

Backfill rules:

```python
# interval_minutes = interval_days * 1440
# stability_days = max(interval_days / -log(0.85), 1 / 1440)
# due_at = local due_date at 00:00 converted to UTC
# mastered -> review; learning -> learning; new -> new
# last_rating and last_reviewed_at come from the latest matching ReviewLog
# duplicate states: retain highest id before adding UNIQUE(user_id, question_id)
# drop due_date and interval_days only after every assertion in the migration test passes
```

Implement `run_migrations()` with three explicit paths:

```python
def run_migrations() -> None:
    # Fresh: no alembic_version and no user table -> import models, create_all, stamp head.
    # Legacy: no alembic_version but user table exists -> stamp 0001, upgrade head.
    # Managed: alembic_version exists -> upgrade head.
```

- [ ] **Step 4: Run migration and existing model tests**

Run: `uv run pytest tests/test_migrations.py tests/test_schedule.py -q`
Expected: new migration tests PASS; any old `due_date` test failures are resolved in Task 3, not by keeping a second writable date column.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add pyproject.toml uv.lock mtt/schedule/models.py mtt/db.py mtt/alembic.ini mtt/alembic tests/test_migrations.py
git commit -m "feat: migrate review state to memory model"
```

### Task 3: Transactional Idempotent Review Submission

**Files:**
- Modify: `mtt/schedule/router.py`
- Modify: `tests/test_schedule.py`
- Modify: `tests/conftest.py` only if a fixture still constructs `due_date`

**Interfaces:**
- Consumes `MemorySnapshot` and `decide()` from Task 1.
- `ReviewSubmit` adds `plan_id: int | None = None`, constrains `duration_ms >= 0`, and validates rating with `Literal`.
- POST `/api/v1/reviews` returns `log_id`, `idempotent`, `state`, and `decision`.

- [ ] **Step 1: Write failing API tests**

```python
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
```

Add this concrete concurrency regression test; the replay response must reconstruct the stored decision from state/log data rather than advance it again:

```python
from concurrent.futures import ThreadPoolExecutor


def test_concurrent_replay_writes_one_log_and_one_rep(client, auth, active_question):
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `uv run --frozen pytest tests/test_schedule.py -q`
Expected: failures on missing `decision`, `due_at`, and replay behavior.

- [ ] **Step 3: Implement transactional submission**

Replace the old fixed-multiplier call with:

```python
def _validate_plan(session: Session, user: User, question: Question,
                   plan_id: int | None) -> None:
    if plan_id is None:
        return
    plan = session.get(Plan, plan_id)
    if plan is None or plan.owner_id != user.id:
        raise HTTPException(404, "plan not found")
    if plan.bank_id is not None and question.bank_id != plan.bank_id:
        raise HTTPException(409, "question is outside the plan bank")


def _decision_from_log(log: ReviewLog) -> dict:
    return {
        "interval_minutes": log.decision_interval_minutes,
        "due_at": log.decision_due_at,
        "algorithm_version": log.decision_algorithm_version,
    }


_validate_plan(session, user, question, payload.plan_id)
snapshot = MemorySnapshot(
    reps=state.reps if state else 0,
    lapses=state.lapses if state else 0,
    stability_days=state.stability_days if state else 1.0,
    interval_minutes=state.interval_minutes if state else 0,
)
decision = decide(snapshot, payload.rating if payload.correct else "again", utcnow())
log = ReviewLog(
    user_id=user.id,
    question_id=question.id,
    client_id=payload.client_id,
    correct=payload.correct,
    rating=payload.rating,
    duration_ms=payload.duration_ms,
    plan_id=payload.plan_id,
    decision_due_at=decision.due_at,
    decision_interval_minutes=decision.interval_minutes,
    decision_algorithm_version=decision.algorithm_version,
)
# Update the single QuestionState and commit once.
# On client_id uniqueness conflict, rollback, load the existing log, and return
# _decision_from_log(existing) with idempotent=True without advancing state.
```

Return this exact shape:

```python
{
    "log_id": log.id,
    "idempotent": False,
    "state": {"status": state.status, "due_at": state.due_at},
    "decision": {
        "interval_minutes": decision.interval_minutes,
        "due_at": decision.due_at,
        "algorithm_version": decision.algorithm_version,
    },
}
```

- [ ] **Step 4: Run submission and regression tests**

Run: `uv run --frozen pytest tests/test_schedule.py tests/test_api_skeleton.py -q`
Expected: PASS with no fixed-multiplier writes remaining.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add mtt/schedule/router.py tests/test_schedule.py tests/conftest.py
git commit -m "fix: make review submission reliable and idempotent"
```

### Task 4: Minute-Level Due Queue and Rating Previews

**Files:**
- Modify: `mtt/schedule/router.py`
- Modify: `tests/test_schedule.py`

**Interfaces:**
- GET `/api/v1/reviews/due` accepts `limit: int = 20` constrained to 1–100.
- Each item includes `state.due_at` and `rating_previews` from `memory.preview()`.
- Queue ordering is `due_at ASC, question_id ASC`; new active questions fill remaining capacity.

- [ ] **Step 1: Write failing queue tests**

```python
from datetime import UTC, datetime, timedelta
from sqlmodel import Session

from mtt.corpus.service import create_question
from mtt.db import engine
from mtt.schedule.models import QuestionState


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
    with Session(engine) as session:
        later = create_question(session, user_id, "后到期", "B", status="active")
        earlier = create_question(session, user_id, "先到期", "A", status="active")
        session.add(QuestionState(user_id=user_id, question_id=later.id,
                                  status="review", due_at=now - timedelta(minutes=5)))
        session.add(QuestionState(user_id=user_id, question_id=earlier.id,
                                  status="review", due_at=now - timedelta(hours=1)))
        session.commit()
    due = client.get("/api/v1/reviews/due", headers=auth).json()
    ids = [q["id"] for q in due]
    assert ids.index(earlier.id) < ids.index(later.id)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `uv run --frozen pytest tests/test_schedule.py -k 'due_queue or future_minutes' -q`
Expected: FAIL on missing previews and old date-only filtering.

- [ ] **Step 3: Implement the queue without N+1 state lookups**

Use one left outer join from `Question` to `QuestionState` for the current user, filter `Question.owner_id`, `Question.status == "active"`, and `(QuestionState.due_at <= now OR QuestionState.id IS NULL)`. Apply bank/category filters before `LIMIT`. Build each snapshot directly from the joined row and call:

```python
STATUS_LABELS = {"new": "新学", "learning": "学习中",
                 "review": "稳定复习", "relearning": "重学中"}
status = state.status if state else "new"
label = ("已掌握" if state and status == "review" and
         state.interval_minutes >= 21 * 1440 else STATUS_LABELS[status])
item["state"] = {
    "status": status,
    "label": label,
    "due_at": state.due_at if state else None,
}
item["rating_previews"] = preview(snapshot, now)
```

Do not keep a second `due_date` query path.

- [ ] **Step 4: Run queue and full schedule tests**

Run: `uv run --frozen pytest tests/test_schedule.py -q`
Expected: PASS.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add mtt/schedule/router.py tests/test_schedule.py
git commit -m "feat: add minute-level review queue and rating previews"
```

### Task 5: Accurate Daily Plan Progress

**Files:**
- Modify: `mtt/schedule/plans.py`
- Modify: `mtt/schedule/router.py`
- Modify: `tests/test_plans.py`

**Interfaces:**
- `_plan_progress()` returns distinct questions completed today, not log count.
- Review submissions may attribute a log to a validated `plan_id`.
- Legacy logs with null `plan_id` fall back to the plan's bank scope.

- [ ] **Step 1: Write failing progress tests**

```python
def test_relearning_does_not_inflate_daily_goal(client, auth, active_question):
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "唯一题数", "bank_id": None, "daily_goal": 10}).json()
    for client_id, rating in (("first", "good"), ("relearn", "again")):
        response = client.post("/api/v1/reviews", headers=auth, json={
            "question_id": active_question.id, "client_id": client_id,
            "correct": rating != "again", "rating": rating,
            "plan_id": plan["id"]})
        assert response.status_code == 201
    current = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                   if p["id"] == plan["id"])
    assert current["today_done"] == 1
```

Add these boundary tests with concrete ownership and legacy-data assertions:

```python
def test_rejects_another_users_plan(client, auth, active_question):
    other = client.post("/api/v1/identity/users", headers=auth, json={
        "username": "other-plan-user", "password": "pw", "role": "user"}).json()
    other_auth = {"Authorization": f"Bearer {other['token']}"}
    plan = client.post("/api/v1/plans", headers=other_auth, json={
        "name": "他人计划", "daily_goal": 5}).json()
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "wrong-plan-owner",
        "correct": True, "rating": "good", "plan_id": plan["id"]})
    assert r.status_code == 404


def test_rejects_question_outside_plan_bank(client, auth, active_question):
    bank = client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "其他题库", "description": ""}).json()
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "限定题库", "bank_id": bank["id"], "daily_goal": 5}).json()
    r = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": active_question.id, "client_id": "wrong-plan-bank",
        "correct": True, "rating": "good", "plan_id": plan["id"]})
    assert r.status_code == 409


def test_legacy_log_uses_bank_scope(client, auth, admin):
    from sqlmodel import Session
    from mtt.corpus.service import create_question
    from mtt.db import engine
    from mtt.schedule.models import ReviewLog
    from mtt.timeutil import utcnow

    user_id, _ = admin
    bank = client.post("/api/v1/questions/banks", headers=auth,
                       json={"name": "旧日志题库", "description": ""}).json()
    plan = client.post("/api/v1/plans", headers=auth, json={
        "name": "旧日志计划", "bank_id": bank["id"], "daily_goal": 5}).json()
    with Session(engine) as session:
        q = create_question(session, user_id, "旧日志题", "答案",
                            status="active", bank_id=bank["id"])
        session.add(ReviewLog(user_id=user_id, question_id=q.id,
                              client_id="legacy-plan-log", rating="good",
                              reviewed_at=utcnow(), plan_id=None))
        session.commit()
    current = next(p for p in client.get("/api/v1/plans", headers=auth).json()
                   if p["id"] == plan["id"])
    assert current["today_done"] == 1
```

- [ ] **Step 2: Run plan tests and verify RED**

Run: `uv run --frozen pytest tests/test_plans.py -q`
Expected: the repeated-answer case returns `2` before the fix.

- [ ] **Step 3: Implement distinct progress**

```python
from sqlalchemy import and_, or_
from sqlmodel import func, select

stmt = (
    select(func.count(func.distinct(ReviewLog.question_id)))
    .select_from(ReviewLog)
    .join(Question, Question.id == ReviewLog.question_id)
    .where(
        ReviewLog.user_id == user.id,
        ReviewLog.is_help_request == False,
        ReviewLog.reviewed_at >= local_day_start_utc(),
    )
)
legacy = ReviewLog.plan_id.is_(None)
if plan.bank_id is not None:
    legacy = and_(legacy, Question.bank_id == plan.bank_id)
stmt = stmt.where(or_(ReviewLog.plan_id == plan.id, legacy))
done = session.exec(stmt).one()
```

Do not count AI help requests or duplicate rows. Keep `goal_met = done >= daily_goal` unchanged.

- [ ] **Step 4: Run plan and schedule regression tests**

Run: `uv run --frozen pytest tests/test_plans.py tests/test_schedule.py -q`
Expected: PASS.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add mtt/schedule/plans.py mtt/schedule/router.py tests/test_plans.py
git commit -m "fix: count unique questions toward daily goals"
```

### Task 6: Export/Import Compatibility

**Files:**
- Modify: `mtt/data/service.py`
- Modify: `mtt/data/router.py`
- Modify: `tests/test_data.py`

**Interfaces:**
- New exports use `version = 2` and include every `QuestionState` memory field plus `ReviewLog.plan_id`, `decision_due_at`, `decision_interval_minutes`, and `decision_algorithm_version`.
- Version-1 payloads containing `due_date` and `interval_days` remain importable.
- Import replay remains idempotent.

- [ ] **Step 1: Write failing compatibility tests**

```python
from datetime import datetime


def _review_export(client, auth, question_id: int, client_id: str) -> dict:
    response = client.post("/api/v1/reviews", headers=auth, json={
        "question_id": question_id, "client_id": client_id,
        "correct": True, "rating": "good"})
    assert response.status_code == 201
    return client.get("/api/v1/data/export", headers=auth).json()


def _wipe_import(client, auth, payload: dict) -> dict:
    assert client.request("DELETE", "/api/v1/data/wipe", headers=auth,
                          json={"confirm": "清空"}).status_code == 200
    assert client.post("/api/v1/data/import", headers=auth, json=payload).status_code == 200
    return client.get("/api/v1/data/export", headers=auth).json()


def _restored_state(bundle: dict, stem: str) -> dict:
    question = next(q for q in bundle["questions"] if q["stem"] == stem)
    return next(s for s in bundle["states"] if s["question_id"] == question["id"])


def test_version_one_state_is_adapted(client, auth, active_question):
    exported = _review_export(client, auth, active_question.id, "v1-adapt")
    assert exported["version"] == 2
    state = next(s for s in exported["states"] if s["question_id"] == active_question.id)
    state["due_date"] = datetime.fromisoformat(state.pop("due_at")).date().isoformat()
    state["interval_days"] = max(1, round(state.pop("interval_minutes") / 1440))
    for field in ("stability_days", "lapses", "last_rating",
                  "last_reviewed_at", "algorithm_version"):
        state.pop(field)
    exported["version"] = 1
    restored = _wipe_import(client, auth, exported)
    result = _restored_state(restored, active_question.stem)
    assert result["interval_minutes"] == state["interval_days"] * 1440
    assert result["stability_days"] > 0
    assert result["due_at"] is not None
    assert result["algorithm_version"] == "ebbinghaus-v1"


def test_new_export_roundtrip_preserves_memory_state(client, auth, active_question):
    exported = _review_export(client, auth, active_question.id, "v2-roundtrip")
    expected = next(s for s in exported["states"] if s["question_id"] == active_question.id)
    restored = _wipe_import(client, auth, exported)
    actual = _restored_state(restored, active_question.stem)
    for field in ("stability_days", "interval_minutes", "due_at", "lapses",
                  "last_rating", "last_reviewed_at", "algorithm_version"):
        assert actual[field] == expected[field]
```

- [ ] **Step 2: Run data tests and verify RED**

Run: `uv run --frozen pytest tests/test_data.py -q`
Expected: FAIL on version 2 and memory-field preservation.

- [ ] **Step 3: Implement a version adapter**

Add one adapter at the import boundary:

```python
def _adapt_state(item: dict) -> dict:
    data = dict(item)
    if "due_at" not in data:
        due_date = datetime.strptime(data.pop("due_date"), "%Y-%m-%d").date()
        data["due_at"] = local_midnight_as_utc(due_date).isoformat()
    if "interval_minutes" not in data:
        days = data.pop("interval_days")
        data["interval_minutes"] = days * 1440
        data["stability_days"] = max(days / -math.log(0.85), 1 / 1440)
    data.setdefault("lapses", 0)
    data.setdefault("last_rating", "")
    data.setdefault("last_reviewed_at", None)
    data.setdefault("algorithm_version", "ebbinghaus-v1")
    return data
```

Use the existing ID remapping and fingerprints. Export raw model fields as JSON; never drop unknown memory fields during wipe/import roundtrip.

- [ ] **Step 4: Run data and full migration tests**

Run: `uv run --frozen pytest tests/test_data.py tests/test_migrations.py -q`
Expected: PASS.

- [ ] **Step 5: Commit the reviewed unit**

```bash
git add mtt/data/service.py mtt/data/router.py tests/test_data.py
git commit -m "feat: preserve memory state during data migration"
```

### Task 7: Startup, Documentation, and Full Verification

**Files:**
- Modify: `mtt/main.py`
- Modify: `moneyToTip/README.md`
- Modify: `tests/test_api_skeleton.py`
- Modify: root `README.md`

**Interfaces:**
- Startup runs `init_db()` through Alembic and then `auto_backup()`.
- README documents the exponential approximation as an initial model, not a guarantee.
- API behavior and migration commands match the implementation exactly.

- [ ] **Step 1: Add a failing startup smoke test**

```python
from datetime import datetime
from pathlib import Path
from sqlalchemy import inspect, text

from mtt.config import settings
from mtt.db import engine


def test_startup_initializes_memory_schema_and_backup(client):
    with client:
        response = client.get("/health")
        assert response.status_code == 200
    columns = {c["name"] for c in inspect(engine).get_columns("questionstate")}
    assert {"due_at", "stability_days", "interval_minutes", "algorithm_version"} <= columns
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == "0002_memory_state"
    stamp = datetime.now().strftime("%Y%m%d")
    backups = list((Path(settings.data_dir) / "backups").glob(f"mtt-{stamp}-*.db"))
    assert backups and all(path.stat().st_size > 0 for path in backups)
```

- [ ] **Step 2: Verify RED**

Run: `uv run --frozen pytest tests/test_api_skeleton.py -q`
Expected: FAIL if startup still calls a non-migration path or backup does not run under the lifespan context.

- [ ] **Step 3: Implement startup and update docs**

Keep the existing startup entry point but ensure `init_db()` finishes migration before `auto_backup()`. Document:

```markdown
### 记忆排期

当前使用可解释的指数遗忘近似 R(t)=exp(-t/S)，根据每题的回忆记录更新稳定性 S。
默认目标保持率为 0.85；答错进入 10 分钟重学。该模型是个性化排期的初始近似，
不承诺保证记忆。算法版本记录在每题状态中，后续可迁移到 FSRS。
```

Update old references to `due_date`, fixed multipliers, and 21-day internal state. Keep the user-facing “已掌握” label only as an interval-based display label.

- [ ] **Step 4: Run complete verification**

Run:

```bash
uv run --frozen pytest -q
uv run python -m compileall -q mtt
```

Expected: all backend tests PASS; compileall exits 0. Then build both frontends to detect contract breakage:

```bash
cd ../moneyToTipApp && npm run build
cd ../moneyToTipConsole && npm run build
```

Expected: both builds exit 0. If the old frontend requires temporary compatibility, keep response keys `state.label` and existing question fields until the frontend plan removes them.

- [ ] **Step 5: Review the diff and commit**

```bash
cd ..
git diff --check
git status --short
git add moneyToTip README.md
git commit -m "docs: document scientific review scheduling"
```

The final review must confirm no unrelated frontend redesign, no fixed-multiplier scheduling path, no writable legacy `due_date`, and no silent review-write failure.

---

## Execution Checkpoints

1. After Task 2: demonstrate fresh install and legacy upgrade on separate temporary databases.
2. After Task 4: demonstrate `again` produces a 10-minute decision and the four preview values come from the same engine.
3. After Task 6: demonstrate v1 import and v2 export/import roundtrip.
4. After Task 7: provide the exact full-test count and both frontend build results.

## Next Plans

- `2026-11-25-mobile-review-experience.md`: reliable ReviewSession reducer, focused review UI, Today/Library/Insights pages, component system, and Playwright coverage.
- `2026-11-25-onboarding-and-settings.md`: password login for App, first-run sample content, server-side active plans, review preferences, and data-management integration.
