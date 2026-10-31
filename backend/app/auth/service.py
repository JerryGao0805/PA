"""认证业务逻辑。函数只改动会话里的数据，由调用方（路由）决定何时提交。

例外：限流记录会立即提交，见 app.core.ratelimit.record。
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import EmailToken, TokenPurpose, User, UserSession
from app.core import ratelimit
from app.core.clock import utcnow
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import (
    generate_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.email.outbox import enqueue_email


@dataclass(frozen=True)
class ClientInfo:
    ip: str
    user_agent: str


@dataclass(frozen=True)
class NewSession:
    token: str
    session: UserSession


# ---------- 查询 ----------


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == email))


# ---------- 会话 ----------


async def create_session(
    db: AsyncSession, user: User, client: ClientInfo, settings: Settings
) -> NewSession:
    token = generate_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=utcnow() + settings.session_ttl,
        user_agent=client.user_agent[:512],
        ip=client.ip[:45],
    )
    db.add(session)
    await db.flush()
    return NewSession(token=token, session=session)


async def revoke_user_sessions(
    db: AsyncSession, user_id: uuid.UUID, *, except_session_id: uuid.UUID | None = None
) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user_id)
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    await db.execute(stmt)


# ---------- 一次性 token ----------


async def _issue_email_token(
    db: AsyncSession, user: User, purpose: TokenPurpose, ttl: timedelta
) -> str:
    """签发新 token，并作废该用户同用途的旧 token（只有最新的一封邮件有效）。"""
    now = utcnow()
    await db.execute(
        update(EmailToken)
        .where(
            EmailToken.user_id == user.id,
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    token = generate_token()
    db.add(
        EmailToken(
            user_id=user.id, purpose=purpose, token_hash=hash_token(token), expires_at=now + ttl
        )
    )
    return token


async def _consume_email_token(
    db: AsyncSession, token: str, purpose: TokenPurpose
) -> EmailToken | None:
    """校验并作废 token。行锁保证并发请求下同一个 token 只能成功使用一次。"""
    now = utcnow()
    row = await db.scalar(
        select(EmailToken)
        .where(
            EmailToken.token_hash == hash_token(token),
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
            EmailToken.expires_at > now,
        )
        .with_for_update()
    )
    if row is not None:
        row.used_at = now
    return row


def _invalid_token() -> ApiError:
    return ApiError(400, "invalid_token", "This link is invalid or has expired")


# ---------- 注册 / 登录 ----------


async def register(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    display_name: str,
    timezone: str,
    client: ClientInfo,
    settings: Settings,
) -> User:
    await ratelimit.enforce(db, f"register:ip:{client.ip}", ratelimit.REGISTER_PER_IP)

    if await get_user_by_email(db, email) is not None:
        raise _email_taken()
    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        timezone=timezone,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # 并发注册同一邮箱时，唯一约束兜底
        await db.rollback()
        raise _email_taken() from None

    await send_verification_email(db, user, settings)
    return user


def _email_taken() -> ApiError:
    return ApiError(409, "email_taken", "This email is already registered")


async def authenticate(db: AsyncSession, *, email: str, password: str, client: ClientInfo) -> User:
    email_key = f"login:email:{email}"
    ip_key = f"login:ip:{client.ip}"
    if await ratelimit.is_limited(
        db, email_key, ratelimit.LOGIN_FAILURES_PER_EMAIL
    ) or await ratelimit.is_limited(db, ip_key, ratelimit.LOGIN_FAILURES_PER_IP):
        raise ratelimit.too_many_requests()

    user = await get_user_by_email(db, email)
    # 用户不存在时 verify_password 也会执行一次等耗时的哈希校验
    if not verify_password(user.password_hash if user else None, password) or user is None:
        await ratelimit.record(db, email_key, ip_key)
        # 不区分「邮箱不存在」和「密码错误」
        raise ApiError(401, "invalid_credentials", "Incorrect email or password")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    await ratelimit.reset(db, email_key)
    return user


# ---------- 邮箱验证 ----------


async def send_verification_email(db: AsyncSession, user: User, settings: Settings) -> None:
    token = await _issue_email_token(
        db, user, TokenPurpose.VERIFY_EMAIL, timedelta(hours=settings.verify_email_ttl_hours)
    )
    # token 放在 URL 片段（#）里：片段不会发给服务器，也就不会出现在反向代理的访问日志中
    enqueue_email(
        db,
        user.email,
        "verify_email",
        {
            "display_name": user.display_name,
            "url": f"{settings.app_base_url}/verify-email#token={token}",
        },
    )


async def resend_verification(db: AsyncSession, user: User, settings: Settings) -> None:
    if user.email_verified:
        return
    await ratelimit.enforce(
        db, f"resend-verification:user:{user.id}", ratelimit.RESEND_VERIFICATION_PER_USER
    )
    await send_verification_email(db, user, settings)


async def verify_email(db: AsyncSession, token: str) -> User:
    row = await _consume_email_token(db, token, TokenPurpose.VERIFY_EMAIL)
    if row is None:
        raise _invalid_token()
    user = await db.get_one(User, row.user_id)
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
    return user


# ---------- 密码 ----------


async def request_password_reset(
    db: AsyncSession, *, email: str, client: ClientInfo, settings: Settings
) -> None:
    """无论邮箱是否存在都静默返回，防止通过这个接口探测哪些邮箱注册过。"""
    await ratelimit.enforce(db, f"forgot:ip:{client.ip}", ratelimit.FORGOT_PASSWORD_PER_IP)
    # 同一邮箱超限时也静默返回，不暴露额外信息
    if not await ratelimit.hit(db, f"forgot:email:{email}", ratelimit.FORGOT_PASSWORD_PER_EMAIL):
        return

    user = await get_user_by_email(db, email)
    if user is None:
        return
    token = await _issue_email_token(
        db,
        user,
        TokenPurpose.RESET_PASSWORD,
        timedelta(minutes=settings.reset_password_ttl_minutes),
    )
    enqueue_email(
        db,
        user.email,
        "reset_password",
        {
            "display_name": user.display_name,
            "url": f"{settings.app_base_url}/reset-password#token={token}",
        },
    )


async def reset_password(db: AsyncSession, *, token: str, new_password: str) -> User:
    row = await _consume_email_token(db, token, TokenPurpose.RESET_PASSWORD)
    if row is None:
        raise _invalid_token()
    user = await db.get_one(User, row.user_id)
    user.password_hash = hash_password(new_password)
    # 能收到重置邮件，说明邮箱确实属于本人
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
    # 密码可能已泄露：让所有设备重新登录
    await revoke_user_sessions(db, user.id)
    return user


async def change_password(
    db: AsyncSession,
    *,
    user: User,
    current_session_id: uuid.UUID,
    current_password: str,
    new_password: str,
) -> None:
    if not verify_password(user.password_hash, current_password):
        raise ApiError(400, "invalid_current_password", "Current password is incorrect")
    user.password_hash = hash_password(new_password)
    # 保留当前设备的登录，其他设备全部下线
    await revoke_user_sessions(db, user.id, except_session_id=current_session_id)
