import os

# 必须在导入 app 之前设置，让引擎连接到测试库
os.environ.setdefault("PA_ENV", "test")
os.environ.setdefault("PA_DATABASE_URL", "postgresql+asyncpg://pa:pa@localhost:5433/pa_test")

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
