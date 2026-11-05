"""基于 Postgres 的简单滑动窗口限流。

每次命中写一行 rate_limit_events，按 key + 时间窗口计数。先查后写不是原子操作，
并发时可能多放过一两次请求；对防暴力破解来说这个精度足够，换来的是不必引入 Redis。
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RateLimitEvent
from app.core.clock import utcnow
from app.core.errors import ApiError


@dataclass(frozen=True)
class Limit:
    limit: int
    window: timedelta


# 登录失败：同一邮箱 15 分钟内最多 5 次，同一 IP 最多 30 次
LOGIN_FAILURES_PER_EMAIL = Limit(5, timedelta(minutes=15))
LOGIN_FAILURES_PER_IP = Limit(30, timedelta(minutes=15))
# 注册：同一 IP 每小时的次数在配置里（register_per_ip_per_hour），端到端测试要调大
FORGOT_PASSWORD_PER_IP = Limit(10, timedelta(hours=1))
FORGOT_PASSWORD_PER_EMAIL = Limit(3, timedelta(hours=1))
RESEND_VERIFICATION_PER_USER = Limit(3, timedelta(hours=1))
# 已登录时再输一次密码（改密码、删除账户）：同一用户 15 分钟内最多错 5 次。
# 防止拿到会话的人（例如别人没退出的电脑）借这两个接口暴力猜密码
PASSWORD_CHECK_FAILURES_PER_USER = Limit(5, timedelta(minutes=15))


async def is_limited(db: AsyncSession, key: str, rule: Limit) -> bool:
    count = await db.scalar(
        select(func.count())
        .select_from(RateLimitEvent)
        .where(RateLimitEvent.key == key, RateLimitEvent.created_at > utcnow() - rule.window)
    )
    return (count or 0) >= rule.limit


async def record(db: AsyncSession, *keys: str) -> None:
    """记录命中并**立即提交**。

    必须马上提交：调用方常常紧接着抛出错误（例如登录失败返回 401），
    请求事务会被回滚，如果不单独提交，命中记录也会跟着丢失，限流形同虚设。
    因此只应在请求开头或失败分支调用，避免把其他未完成的改动一起提交。
    """
    db.add_all(RateLimitEvent(key=key) for key in keys)
    await db.commit()


async def hit(db: AsyncSession, key: str, rule: Limit) -> bool:
    """检查并记一次命中。返回 True 表示放行，False 表示已超限（超限时不再记录）。"""
    if await is_limited(db, key, rule):
        return False
    await record(db, key)
    return True


async def enforce(db: AsyncSession, key: str, rule: Limit) -> None:
    """超限时抛 429。"""
    if not await hit(db, key, rule):
        raise too_many_requests()


async def reset(db: AsyncSession, key: str) -> None:
    await db.execute(delete(RateLimitEvent).where(RateLimitEvent.key == key))


def too_many_requests() -> ApiError:
    return ApiError(429, "rate_limited", "Too many attempts, please try again later")
