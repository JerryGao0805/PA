from typing import Annotated

from pydantic import BaseModel, Field

from app.auth.schemas import DisplayName, Timezone


class AccountUpdate(BaseModel):
    """只改传了的字段"""

    display_name: DisplayName | None = None
    timezone: Timezone | None = None


class DeleteAccountIn(BaseModel):
    # 和登录一样只限制上限：旧规则下设的密码也要能输
    password: Annotated[str, Field(min_length=1, max_length=128)]
