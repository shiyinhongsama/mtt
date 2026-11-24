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
