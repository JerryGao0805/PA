# syntax=docker/dockerfile:1
# API、worker 和数据库迁移共用这一个镜像，用 command 区分：
#   uvicorn（默认）| python -m app.worker | alembic upgrade head

FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.10.11 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# 先只装依赖：代码改了，这一层还能用缓存
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev --no-install-project
COPY . .

FROM python:3.13-slim
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
# 前面是 Caddy：--proxy-headers 让 request.client 是用户的真实 IP（限流按它算）。
# 信任所有来源的转发头是安全的：API 不对外暴露端口，只有同一个 Docker 网络里的 Caddy 能访问它，
# 而 Caddy 会丢掉用户自己带的 X-Forwarded-For，换成真实的来源 IP
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
