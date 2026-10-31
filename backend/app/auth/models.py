import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Identity, Index, String, func
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    # citext：邮箱大小写不敏感地唯一
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100), server_default="")
    locale: Mapped[str] = mapped_column(String(16), server_default="zh-CN")
    # IANA 时区名，例如 Asia/Shanghai；截止日期按它解释
    timezone: Mapped[str] = mapped_column(String(64), server_default="UTC")
    email_verified_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class UserSession(Base):
    """登录会话。Cookie 里是随机 token，这里只存它的 SHA-256 哈希。"""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(index=True)
    user_agent: Mapped[str] = mapped_column(String(512), server_default="")
    ip: Mapped[str] = mapped_column(String(45), server_default="")


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"


class EmailToken(Base):
    """邮件里发出的一次性 token（验证邮箱、重置密码）。同样只存哈希。"""

    __tablename__ = "email_tokens"
    __table_args__ = (
        CheckConstraint("purpose IN ('verify_email', 'reset_password')", name="purpose_valid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RateLimitEvent(Base):
    """限流计数：每次命中记一行，按 key + 时间窗口统计。旧记录由 worker 定期清理。"""

    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events_key_created_at", "key", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    key: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
