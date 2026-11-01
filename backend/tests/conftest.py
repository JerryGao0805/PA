import os

# 必须在导入 app 之前设置，让引擎连接到测试库
os.environ.setdefault("PA_ENV", "test")
os.environ.setdefault("PA_DATABASE_URL", "postgresql+asyncpg://pa:pa@localhost:5433/pa_test")
os.environ.setdefault("PA_EMAIL_BACKEND", "console")

import asyncio
import subprocess
import sys
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AbstractAsyncContextManager
from pathlib import Path

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import Base, engine
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASE_URL = "http://testserver"
DEFAULT_PASSWORD = "correct horse battery"


async def _reset_schema() -> None:
    # 用一条独立连接，不经过应用的连接池（连接池绑定在测试的事件循环上）
    conn = await asyncpg.connect(os.environ["PA_DATABASE_URL"].replace("+asyncpg", ""))
    try:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> Iterator[None]:
    """每次测试运行前：清空测试库，再用 Alembic 迁移到最新（顺带验证迁移脚本本身）。"""
    asyncio.run(_reset_schema())
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=os.environ,
        check=True,
        capture_output=True,
    )
    yield


@pytest.fixture(autouse=True)
async def _clean_tables() -> AsyncIterator[None]:
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


ClientFactory = Callable[[], AbstractAsyncContextManager[AsyncClient]]


@pytest.fixture
def make_client() -> ClientFactory:
    """创建独立的客户端（各自有独立的 Cookie），用来模拟多台设备。"""

    def factory() -> AbstractAsyncContextManager[AsyncClient]:
        return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)

    return factory


@pytest.fixture
async def client(make_client: ClientFactory) -> AsyncIterator[AsyncClient]:
    async with make_client() as c:
        yield c


RegisterFn = Callable[..., Awaitable[dict[str, object]]]


@pytest.fixture
def register(client: AsyncClient) -> RegisterFn:
    """注册一个用户（默认用 client 这个客户端，注册后该客户端处于登录状态）。"""

    async def _register(
        email: str = "alice@example.com",
        password: str = DEFAULT_PASSWORD,
        c: AsyncClient | None = None,
        **extra: object,
    ) -> dict[str, object]:
        resp = await (c or client).post(
            "/api/v1/auth/register", json={"email": email, "password": password, **extra}
        )
        assert resp.status_code == 201, resp.text
        data: dict[str, object] = resp.json()
        return data

    return _register
