from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorOut(BaseModel):
    """所有业务错误的统一响应格式。前端根据 code 显示对应的本地化文案。"""

    code: str
    message: str


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        body = ErrorOut(code=exc.code, message=exc.message)
        return JSONResponse(status_code=exc.status_code, content=body.model_dump())


# 在路由上声明可能的错误响应，让 OpenAPI（以及生成的前端类型）知道错误体的结构
def error_responses(*status_codes: int) -> dict[int | str, dict[str, object]]:
    return {code: {"model": ErrorOut} for code in status_codes}
