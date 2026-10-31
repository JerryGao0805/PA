from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app import health
from app.core.config import get_settings
from app.core.db import engine


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Personal Assistant API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        # 生产环境不暴露交互式文档
        docs_url=None if settings.is_prod else "/api/docs",
        redoc_url=None,
    )

    api_v1 = APIRouter(prefix="/api/v1")
    api_v1.include_router(health.router)
    app.include_router(api_v1)
    return app


app = create_app()
