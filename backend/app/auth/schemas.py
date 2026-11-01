import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("unknown timezone") from None
    return value


Email = Annotated[EmailStr, AfterValidator(_normalize_email)]
# NIST SP 800-63B：至少 8 位、不强制字符组合规则；上限防止超长输入拖慢哈希
Password = Annotated[str, Field(min_length=8, max_length=128)]
Timezone = Annotated[str, Field(max_length=64), AfterValidator(_validate_timezone)]


class RegisterIn(BaseModel):
    email: Email
    password: Password
    display_name: Annotated[str, Field(max_length=100)] = ""
    timezone: Timezone = "UTC"


class LoginIn(BaseModel):
    email: Email
    # 登录时不校验长度规则，避免旧规则下的密码无法登录；只限制上限
    password: Annotated[str, Field(min_length=1, max_length=128)]


class TokenIn(BaseModel):
    token: Annotated[str, Field(min_length=16, max_length=128)]


class ForgotPasswordIn(BaseModel):
    email: Email


class ResetPasswordIn(BaseModel):
    token: Annotated[str, Field(min_length=16, max_length=128)]
    password: Password


class ChangePasswordIn(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Password


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    email_verified: bool
    locale: str
    timezone: str
    created_at: datetime
