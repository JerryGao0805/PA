from datetime import UTC, datetime


def utcnow() -> datetime:
    """当前 UTC 时间（带时区信息）。集中在一处，方便测试时替换。"""
    return datetime.now(UTC)
