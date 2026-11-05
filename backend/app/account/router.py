from fastapi import APIRouter, Response, status

from app.account import service
from app.account.schemas import AccountUpdate, DeleteAccountIn
from app.auth.deps import AppSettings, CurrentUser, DbSession, clear_session_cookie
from app.auth.schemas import UserOut
from app.core.errors import error_responses

router = APIRouter(prefix="/account", tags=["account"], responses=error_responses(401))


@router.patch("", response_model=UserOut)
async def update_account(body: AccountUpdate, user: CurrentUser, db: DbSession) -> UserOut:
    service.update_account(user, body)
    await db.commit()
    return UserOut.model_validate(user)


# 带请求体（密码），所以用 POST 而不是 DELETE：有些代理和客户端会丢掉 DELETE 的请求体
@router.post(
    "/delete",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(400, 429),
)
async def delete_account(
    body: DeleteAccountIn,
    response: Response,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
) -> None:
    await service.delete_account(db, user=user, password=body.password)
    await db.commit()
    clear_session_cookie(response, settings)
