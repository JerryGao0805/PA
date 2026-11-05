from pydantic import BaseModel

from app.auth.schemas import CurrentPassword, DisplayName, Timezone


class AccountUpdate(BaseModel):
    """只改传了的字段"""

    display_name: DisplayName | None = None
    timezone: Timezone | None = None


class DeleteAccountIn(BaseModel):
    password: CurrentPassword
