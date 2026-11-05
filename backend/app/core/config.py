from datetime import timedelta
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。所有字段都可以用 PA_ 前缀的环境变量覆盖，例如 PA_DATABASE_URL。"""

    model_config = SettingsConfigDict(env_prefix="PA_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "postgresql+asyncpg://pa:pa@localhost:5433/pa"
    # 前端访问地址：用于生成邮件里的链接，以及校验写请求的 Origin 头
    app_base_url: str = "http://localhost:5173"

    # --- 会话 ---
    session_cookie_name: str = "pa_session"
    session_ttl_days: int = 30
    # 生产环境必须为 True（仅 HTTPS 传输 Cookie）；本地开发走 http，所以默认跟随 env
    cookie_secure: bool | None = None

    # --- 限流 ---
    # 同一 IP 每小时最多注册几次。端到端测试里每个用例都注册一个新账号，会把它调大。
    # 配成 0 会让所有注册都被拒绝，所以至少是 1（配错了启动时直接报错）
    register_per_ip_per_hour: int = Field(default=10, ge=1)

    # --- 一次性 token 有效期 ---
    verify_email_ttl_hours: int = 24
    reset_password_ttl_minutes: int = 60

    # --- 邮件 ---
    email_backend: Literal["console", "smtp", "ses"] = "smtp"
    email_from: str = "Personal Assistant <no-reply@localhost>"
    smtp_host: str = "localhost"
    smtp_port: int = 1026  # 本地 Mailpit
    ses_region: str = "us-east-1"

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def session_ttl(self) -> timedelta:
        return timedelta(days=self.session_ttl_days)

    @property
    def secure_cookies(self) -> bool:
        return self.is_prod if self.cookie_secure is None else self.cookie_secure

    @property
    def app_origin(self) -> str:
        """app_base_url 的 origin 部分（scheme://host[:port]），用于 CSRF 校验。"""
        parts = urlsplit(self.app_base_url)
        return f"{parts.scheme}://{parts.netloc}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
