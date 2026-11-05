from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.auth import service
from app.auth.deps import (
    AppSettings,
    Auth,
    AuthContext,
    CurrentUser,
    DbSession,
    clear_session_cookie,
    client_info,
    optional_auth,
    set_session_cookie,
)
from app.auth.schemas import (
    ChangePasswordIn,
    ForgotPasswordIn,
    LoginIn,
    RegisterIn,
    ResetPasswordIn,
    TokenIn,
    UserOut,
)
from app.core.errors import error_responses

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=UserOut,
    responses=error_responses(409, 429),
)
async def register(
    body: RegisterIn, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> UserOut:
    client = client_info(request)
    user = await service.register(
        db,
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        timezone=body.timezone,
        client=client,
        settings=settings,
    )
    new = await service.create_session(db, user, client, settings)
    await db.commit()
    set_session_cookie(response, new.token, settings)
    return UserOut.model_validate(user)


@router.post("/login", response_model=UserOut, responses=error_responses(401, 429))
async def login(
    body: LoginIn, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> UserOut:
    client = client_info(request)
    user = await service.authenticate(db, email=body.email, password=body.password, client=client)
    new = await service.create_session(db, user, client, settings)
    await db.commit()
    set_session_cookie(response, new.token, settings)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: DbSession,
    settings: AppSettings,
    auth: Annotated[AuthContext | None, Depends(optional_auth)],
) -> None:
    # 未登录也返回成功并清掉 Cookie，让前端的退出操作总是幂等的
    if auth is not None:
        await db.delete(auth.session)
        await db.commit()
    clear_session_cookie(response, settings)


@router.get("/me", response_model=UserOut, responses=error_responses(401))
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/verify-email", response_model=UserOut, responses=error_responses(400))
async def verify_email(body: TokenIn, db: DbSession) -> UserOut:
    # 不要求登录：用户可能在另一台设备或浏览器里打开邮件
    user = await service.verify_email(db, body.token)
    await db.commit()
    return UserOut.model_validate(user)


@router.post(
    "/resend-verification",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 429),
)
async def resend_verification(user: CurrentUser, db: DbSession, settings: AppSettings) -> None:
    await service.resend_verification(db, user, settings)
    await db.commit()


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(429),
)
async def forgot_password(
    body: ForgotPasswordIn, request: Request, db: DbSession, settings: AppSettings
) -> None:
    await service.request_password_reset(
        db, email=body.email, client=client_info(request), settings=settings
    )
    await db.commit()


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(400),
)
async def reset_password(
    body: ResetPasswordIn, response: Response, db: DbSession, settings: AppSettings
) -> None:
    await service.reset_password(db, token=body.token, new_password=body.password)
    await db.commit()
    # 当前浏览器即使登录着也已被下线，顺手清掉 Cookie
    clear_session_cookie(response, settings)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(400, 401, 429),
)
async def change_password(body: ChangePasswordIn, auth: Auth, db: DbSession) -> None:
    await service.change_password(
        db,
        user=auth.user,
        current_session_id=auth.session.id,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    await db.commit()
