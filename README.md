# 个人助手

以任务管理为核心的个人助手 Web 应用。需求与架构见 [docs/plan.md](docs/plan.md)。

- 前端：Vite + React + TypeScript + TanStack Router/Query + Tailwind CSS（`frontend/`）
- 后端：FastAPI + SQLAlchemy 2.0 + PostgreSQL（`backend/`）

## 本地开发

需要：Docker、Node 22+、[uv](https://docs.astral.sh/uv/)。

```bash
# 1. 启动 Postgres（5433）和 Mailpit（SMTP 1026，Web UI http://localhost:8026）
docker compose up -d

# 2. 后端：http://localhost:8001，API 文档在 /api/docs
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8001

# 3. 前端：http://localhost:5173（/api 会被代理到后端）
cd frontend
npm install
npm run dev
```

端口刻意避开了 5432/8000/1025/8025，方便和其他本地项目同时运行。

## 常用命令

| 目的 | 命令 |
|---|---|
| 后端测试 | `cd backend && uv run pytest` |
| 后端 lint / 格式 / 类型 | `uv run ruff check . && uv run ruff format . && uv run mypy app scripts tests` |
| 新建数据库迁移 | `cd backend && uv run alembic revision --autogenerate -m "描述"` |
| 前端测试 | `cd frontend && npm test` |
| 前端 lint / 类型 | `npm run lint && npm run typecheck` |
| 后端接口变更后重新生成前端类型 | `cd frontend && npm run gen:api` |

## 约定

- 路由文件（`frontend/src/routes/`）只放路由定义，页面组件放在 `src/features/<模块>/`
- 后端按模块组织：`app/<模块>/{router,service,models,schemas}.py`，新模型要在 `app/models.py` 里导入
- `openapi.json` 和 `src/lib/api-schema.d.ts` 是生成文件，但要提交；CI 会检查它们和后端是否同步
- TypeScript 暂时固定在 5.9：TS 7 不再提供 JS 编译器 API，`openapi-typescript` 等工具还没适配
