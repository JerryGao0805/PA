from sqlalchemy import func, select

from app.auth.models import UserSession
from app.core.db import SessionLocal
from app.email.models import OutboxStatus
from app.email.sender import ConsoleEmailSender, OutgoingEmail
from app.worker import MAX_ATTEMPTS, cleanup_expired, process_outbox_batch, retry_delay
from tests.conftest import RegisterFn
from tests.helpers import execute, outbox_for


class FailingSender:
    def __init__(self) -> None:
        self.calls = 0

    async def send(self, email: OutgoingEmail) -> None:
        self.calls += 1
        raise ConnectionError("smtp down")


async def test_worker_sends_and_wipes_payload(register: RegisterFn) -> None:
    await register(email="amy@example.com", display_name="Amy")
    sender = ConsoleEmailSender()

    assert await process_outbox_batch(sender) == 1
    assert len(sender.sent) == 1
    sent = sender.sent[0]
    assert sent.to == "amy@example.com"
    assert "验证" in sent.subject
    assert "/verify-email#token=" in sent.text
    assert "Amy" in sent.html

    [row] = await outbox_for("amy@example.com")
    assert row.status == OutboxStatus.SENT
    assert row.sent_at is not None
    assert row.payload == {}  # 一次性链接不留在数据库里

    # 已发送的不会被重复发送
    assert await process_outbox_batch(sender) == 0


async def test_worker_retries_with_backoff_then_gives_up(register: RegisterFn) -> None:
    await register(email="ben@example.com")
    sender = FailingSender()

    assert await process_outbox_batch(sender) == 1
    [row] = await outbox_for("ben@example.com")
    assert row.status == OutboxStatus.PENDING
    assert row.attempts == 1
    assert row.last_error and "smtp down" in row.last_error
    assert row.next_attempt_at > row.created_at

    # 还没到重试时间，不会被领取
    assert await process_outbox_batch(sender) == 0

    for _ in range(MAX_ATTEMPTS - 1):
        await execute("UPDATE email_outbox SET next_attempt_at = now() - interval '1 second'")
        await process_outbox_batch(sender)

    [row] = await outbox_for("ben@example.com")
    assert row.status == OutboxStatus.FAILED
    assert row.attempts == MAX_ATTEMPTS
    assert row.payload == {}
    assert sender.calls == MAX_ATTEMPTS


def test_retry_delay_is_exponential_and_capped() -> None:
    assert retry_delay(1).total_seconds() == 30
    assert retry_delay(2).total_seconds() == 60
    assert retry_delay(3).total_seconds() == 120
    assert retry_delay(20).total_seconds() == 3600


async def test_cleanup_removes_expired_sessions(register: RegisterFn) -> None:
    await register()
    await execute("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    await cleanup_expired()
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(UserSession)) == 0
