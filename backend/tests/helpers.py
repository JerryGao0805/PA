from typing import Any

from sqlalchemy import select, text

from app.core.db import SessionLocal
from app.email.models import EmailOutbox


async def outbox_for(email: str, template: str | None = None) -> list[EmailOutbox]:
    async with SessionLocal() as db:
        stmt = select(EmailOutbox).where(EmailOutbox.to_address == email).order_by(EmailOutbox.id)
        if template is not None:
            stmt = stmt.where(EmailOutbox.template == template)
        return list((await db.scalars(stmt)).all())


async def latest_token(email: str, template: str) -> str:
    """从最近一封待发邮件的链接里取出 token（链接形如 .../verify-email#token=xxx）。"""
    rows = await outbox_for(email, template)
    assert rows, f"no {template} email queued for {email}"
    url = str(rows[-1].payload["url"])
    return url.split("#token=", 1)[1]


async def execute(sql: str, **params: Any) -> None:
    async with SessionLocal() as db:
        await db.execute(text(sql), params)
        await db.commit()
