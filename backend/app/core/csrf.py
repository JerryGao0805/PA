"""CSRF 防护：校验写请求的 Origin 头。

会话 Cookie 是 SameSite=Lax，跨站的 POST 本来就不会带上它；这里再加一层：
浏览器发出的写请求一定带 Origin，只要它和前端的 origin 不一致就拒绝。
没有 Origin 的请求（curl、服务端调用）放行，因为它们拿不到受害者浏览器里的 Cookie。
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.core.config import Settings
from app.core.errors import ErrorOut

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def install_csrf_protection(app: FastAPI, settings: Settings) -> None:
    allowed_origin = settings.app_origin

    @app.middleware("http")
    async def _check_origin(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin is not None and origin != allowed_origin:
                body = ErrorOut(code="csrf_origin_mismatch", message="Cross-origin request blocked")
                return JSONResponse(status_code=403, content=body.model_dump())
        return await call_next(request)
