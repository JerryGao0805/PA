"""重建一次性数据库（E2E 用）：库不存在就创建，然后清空并用 Alembic 迁移到最新。

用法：PA_DATABASE_URL=postgresql+asyncpg://pa:pa@localhost:5433/pa_e2e \
        uv run python scripts/reset_db.py
为了防止误删开发库，只接受名字以 _e2e 或 _test 结尾的数据库。
"""

import asyncio
import sys
from pathlib import Path

import asyncpg
from sqlalchemy.engine import URL, make_url

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from alembic.config import Config

from alembic import command
from app.core.config import get_settings

BACKEND_DIR = Path(__file__).resolve().parent.parent
SAFE_SUFFIXES = ("_e2e", "_test")


def _dsn(url: URL, database: str | None = None) -> str:
    plain = url.set(drivername="postgresql", database=database or url.database)
    return plain.render_as_string(hide_password=False)


async def recreate_schema(url: URL) -> None:
    try:
        conn = await asyncpg.connect(_dsn(url))
    except asyncpg.InvalidCatalogNameError:
        admin = await asyncpg.connect(_dsn(url, "postgres"))
        try:
            await admin.execute(f'CREATE DATABASE "{url.database}"')
        finally:
            await admin.close()
        conn = await asyncpg.connect(_dsn(url))
    try:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    finally:
        await conn.close()


def main() -> None:
    url = make_url(get_settings().database_url)
    if not (url.database or "").endswith(SAFE_SUFFIXES):
        sys.exit(f"refusing to reset {url.database!r}: database name must end with _e2e or _test")
    asyncio.run(recreate_schema(url))
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")
    print(f"database {url.database} is reset and migrated")


if __name__ == "__main__":
    main()
