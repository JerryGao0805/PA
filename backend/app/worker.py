"""后台 worker：发送 outbox 里的邮件，并定期清理过期数据。

运行：uv run python -m app.worker
可以同时跑多个实例：取任务时用 FOR UPDATE SKIP LOCKED，同一封邮件不会被重复领取。
"""

import asyncio
import contextlib
import logging
import signal
from datetime import timedelta

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.models import EmailToken, RateLimitEvent, UserSession
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.email.models import EmailOutbox, OutboxStatus
from app.email.sender import EmailSender, OutgoingEmail, build_email_sender
from app.email.templates import render_email
from app.tasks.models import Task

logger = logging.getLogger("app.worker")

BATCH_SIZE = 20
MAX_ATTEMPTS = 8
POLL_INTERVAL = 2.0  # 秒：队列空闲时的轮询间隔
CLEANUP_INTERVAL = 600.0  # 秒
# 软删除的任务保留这么久，之后永久删除
DELETED_TASK_RETENTION = timedelta(days=30)


def retry_delay(attempts: int) -> timedelta:
    """指数退避：30s、1m、2m、4m……最长 1 小时。"""
    return timedelta(seconds=min(30 * 2 ** (attempts - 1), 3600))


async def process_outbox_batch(
    sender: EmailSender, session_factory: async_sessionmaker[AsyncSession] = SessionLocal
) -> int:
    """领取并发送一批到期的邮件，返回处理的数量。"""
    async with session_factory() as db, db.begin():
        rows = (
            await db.scalars(
                select(EmailOutbox)
                .where(
                    EmailOutbox.status == OutboxStatus.PENDING,
                    EmailOutbox.next_attempt_at <= utcnow(),
                )
                .order_by(EmailOutbox.next_attempt_at)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        ).all()

        for row in rows:
            try:
                rendered = render_email(row.template, row.payload)
                await sender.send(
                    OutgoingEmail(
                        to=row.to_address,
                        subject=rendered.subject,
                        text=rendered.text,
                        html=rendered.html,
                        # 每次重试都相同。带上创建时间：从备份恢复数据库后 id 会被重新使用，
                        # 只用 id 可能撞上 24 小时内发过的另一封
                        idempotency_key=f"outbox-{row.id}-{row.created_at.timestamp()}",
                    )
                )
            except Exception as exc:
                row.attempts += 1
                row.last_error = repr(exc)[:2000]
                if row.attempts >= MAX_ATTEMPTS:
                    row.status = OutboxStatus.FAILED
                    row.payload = {}
                    logger.error("email %s failed permanently: %r", row.id, exc)
                else:
                    row.next_attempt_at = utcnow() + retry_delay(row.attempts)
                    logger.warning("email %s attempt %d failed: %r", row.id, row.attempts, exc)
            else:
                row.status = OutboxStatus.SENT
                row.sent_at = utcnow()
                # 发送成功后清空 payload：里面的一次性链接不应该长期留在数据库里
                row.payload = {}
                logger.info("email %s sent (%s)", row.id, row.template)
        return len(rows)


async def cleanup_expired(
    session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
) -> None:
    now = utcnow()
    async with session_factory() as db, db.begin():
        await db.execute(delete(UserSession).where(UserSession.expires_at < now))
        await db.execute(
            delete(EmailToken).where(
                or_(EmailToken.expires_at < now, EmailToken.used_at.is_not(None)),
                EmailToken.created_at < now - timedelta(days=7),
            )
        )
        # 最长的限流窗口是 1 小时，保留 1 天足够
        await db.execute(
            delete(RateLimitEvent).where(RateLimitEvent.created_at < now - timedelta(days=1))
        )
        await db.execute(
            delete(EmailOutbox).where(
                EmailOutbox.status != OutboxStatus.PENDING,
                EmailOutbox.created_at < now - timedelta(days=30),
            )
        )
        await db.execute(delete(Task).where(Task.deleted_at < now - DELETED_TASK_RETENTION))


async def run() -> None:
    settings = get_settings()
    sender = build_email_sender(settings)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    logger.info("worker started (email backend: %s)", settings.email_backend)
    last_cleanup = 0.0
    while not stop.is_set():
        try:
            if loop.time() - last_cleanup > CLEANUP_INTERVAL:
                await cleanup_expired()
                last_cleanup = loop.time()
            processed = await process_outbox_batch(sender)
        except Exception:
            # 数据库暂时不可用等情况：记录后稍等再试，worker 本身不退出
            logger.exception("worker iteration failed")
            processed = 0
        if processed == 0:
            # 等待下一轮，但收到停止信号时立即醒来
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL)
    await engine.dispose()
    logger.info("worker stopped")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run())
