"""简化排期引擎（R-schedule-04）。

规则（冷启动友好，术语只在服务端内部使用）：
- 间隔倍增：again ×1（最低 1 天）、hard ×1.5、good ×2、easy ×2.5
  → 答错的题再次出现早于答对的题（R-schedule-03）
- 三档状态：interval == 0 → new；0 < interval <= 21 → learning；> 21 → mastered（R-schedule-01）

未来切 FSRS 时只替换本模块的 next_interval 实现，review log 格式不变（R-schedule-05）。
"""

from datetime import date, timedelta

MASTERED_THRESHOLD_DAYS = 21  # 成熟知识量口径（假设 A7）

RATING_MULTIPLIER = {
    "again": 1.0,
    "hard": 1.5,
    "good": 2.0,
    "easy": 2.5,
}


def next_interval(interval_days: int, rating: str) -> int:
    if rating == "again":
        return 1
    return max(1, round(interval_days * RATING_MULTIPLIER.get(rating, 2.0)))


def status_for(interval_days: int) -> str:
    if interval_days <= 0:
        return "new"
    if interval_days > MASTERED_THRESHOLD_DAYS:
        return "mastered"
    return "learning"


def apply_review(interval_days: int, rating: str) -> tuple[int, str, date]:
    """返回 (新间隔, 新状态, 新的到期日)。"""
    interval = next_interval(interval_days, rating)
    return interval, status_for(interval), date.today() + timedelta(days=interval)
