from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.email.models import EmailOutbox
from app.email.templates import TEMPLATES


def enqueue_email(db: AsyncSession, to: str, template: str, payload: dict[str, Any]) -> None:
    """把邮件放进待发队列。和业务数据在同一个事务里提交，由 worker 异步发送。"""
    if template not in TEMPLATES:
        raise ValueError(f"unknown email template: {template}")
    db.add(EmailOutbox(to_address=to, template=template, payload=payload))
