from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, Identity, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class OutboxStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class EmailOutbox(Base):
    """待发邮件队列（transactional outbox）。

    业务代码在同一个事务里写入这张表，提交成功才会被 worker 发出；
    这样不会出现「数据回滚了但邮件已经发出」或「数据提交了但邮件丢了」的情况。
    """

    __tablename__ = "email_outbox"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="status_valid"),
        # worker 只扫描待发记录，用部分索引让这个查询保持很小
        Index(
            "ix_email_outbox_pending",
            "next_attempt_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    to_address: Mapped[str] = mapped_column(String(320))
    template: Mapped[str] = mapped_column(String(64))
    # 渲染模板所需的数据。里面可能有一次性链接，发送成功后会清空
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), server_default=OutboxStatus.PENDING.value)
    attempts: Mapped[int] = mapped_column(server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    sent_at: Mapped[datetime | None]
