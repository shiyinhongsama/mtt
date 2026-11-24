"""统一的带时区 UTC 时间（SQLAlchemy 2.x 要求 tz-aware）。"""

from datetime import UTC, date, datetime, time, timedelta


def utcnow() -> datetime:
    return datetime.now(UTC)


def local_midnight_as_utc(day: date) -> datetime:
    """将服务器本地某一天的零点转换为带时区的 UTC 时间。"""
    return datetime.combine(day, time.min).astimezone().astimezone(UTC)


def local_day_start_utc(day_offset: int = 0) -> datetime:
    """本地时区某天 0 点，换算成 UTC aware datetime。

    SQLite 中时间以 UTC ISO 字符串存储，比较必须在同一时区；
    "今日"按服务器本地时区算（自用部署，用户与服务同地）。
    """
    now = datetime.now().astimezone()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return (midnight + timedelta(days=day_offset)).astimezone(UTC)
