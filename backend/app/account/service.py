"""账户设置和删除账户。函数只改动会话里的数据，由调用方（路由）决定何时提交。"""

from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.account.schemas import AccountUpdate
from app.auth.models import User
from app.auth.service import check_current_password
from app.email.models import EmailOutbox


def update_account(user: User, body: AccountUpdate) -> None:
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.timezone is not None:
        user.timezone = body.timezone


async def delete_account(db: AsyncSession, *, user: User, password: str) -> None:
    """永久删除账户和它的全部数据，不能恢复。

    会话、邮件 token、项目、任务、标签都由外键 ON DELETE CASCADE 跟着删除。
    发件箱按收件地址存、不关联用户，单独删掉：还没发的不再发，发过的也不留下邮箱地址
    """
    await check_current_password(db, user, password)
    await db.execute(delete(EmailOutbox).where(func.lower(EmailOutbox.to_address) == user.email))
    await db.execute(delete(User).where(User.id == user.id))
