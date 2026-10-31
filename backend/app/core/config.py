from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。所有字段都可以用 PA_ 前缀的环境变量覆盖，例如 PA_DATABASE_URL。"""

    model_config = SettingsConfigDict(env_prefix="PA_", env_file=".env", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "postgresql+asyncpg://pa:pa@localhost:5433/pa"
    # 前端访问地址：用于生成邮件里的链接，以及校验写请求的 Origin 头
    app_base_url: str = "http://localhost:5173"

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
