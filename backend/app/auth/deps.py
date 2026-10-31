from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User, UserSession
from app.auth.service import ClientInfo
from app.core.clock import utcnow
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.errors import ApiError
from app.core.security import hash_token

# 会话剩余有效期比完整有效期少超过这个值时才续期，避免每个请求都写一次数据库
RENEW_AFTER = timedelta(days=1)

DbSession = Annotated[AsyncSession, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_settings)]


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: UserSession


def client_info(request: Request) -> ClientInfo:
    # 生产环境 uvicorn 以 --proxy-headers 启动，request.client 已经是 Caddy 转发的真实 IP
    ip = request.client.host if request.client else ""
    return ClientInfo(ip=ip, user_agent=request.headers.get("user-agent", ""))


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=int(settings.session_ttl.total_seconds()),
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


async def optional_auth(
    request: Request, response: Response, db: DbSession, settings: AppSettings
) -> AuthContext | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    now = utcnow()
    row = (
        await db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now)
        )
    ).one_or_none()
    if row is None:
        return None
    session, user = row

    # 滑动续期：活跃用户的会话不断延长，长期不用的会话自然过期
    if session.expires_at - now < settings.session_ttl - RENEW_AFTER:
        session.expires_at = now + settings.session_ttl
        session.last_seen_at = now
        await db.commit()
        set_session_cookie(response, token, settings)
    return AuthContext(user=user, session=session)


async def require_auth(
    auth: Annotated[AuthContext | None, Depends(optional_auth)],
) -> AuthContext:
    if auth is None:
        raise ApiError(401, "not_authenticated", "Please sign in")
    return auth


async def require_user(auth: Annotated[AuthContext, Depends(require_auth)]) -> User:
    return auth.user


Auth = Annotated[AuthContext, Depends(require_auth)]
CurrentUser = Annotated[User, Depends(require_user)]
