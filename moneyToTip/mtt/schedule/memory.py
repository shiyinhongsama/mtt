"""Transparent Ebbinghaus-inspired exponential forgetting model."""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, cast

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


def decide(
    snapshot: MemorySnapshot,
    rating: Rating,
    now: datetime,
    target_retention: float = DEFAULT_TARGET_RETENTION,
) -> MemoryDecision:
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
    return MemoryDecision(
        stability,
        minutes,
        now + timedelta(minutes=minutes),
        status,
        ALGORITHM_VERSION,
    )


def preview(snapshot: MemorySnapshot, now: datetime) -> dict[str, dict[str, object]]:
    result = {}
    for rating in ("again", "hard", "good", "easy"):
        decision = decide(snapshot, cast(Rating, rating), now)
        result[rating] = {
            "interval_minutes": decision.interval_minutes,
            "due_at": decision.due_at,
            "status": decision.status,
        }
    return result
