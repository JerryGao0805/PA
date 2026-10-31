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

# 3. 邮件 worker（另开一个终端）：把待发邮件投递到 Mailpit
cd backend
uv run python -m app.worker

# 4. 前端：http://localhost:5173（/api 会被代理到后端）
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
| 前端 lint / 格式 / 类型 | `npm run lint && npm run format && npm run typecheck` |
| 端到端测试（需先 `docker compose up -d`） | `cd frontend && npm run e2e`（自动启动 API、worker 和前端） |
| 后端接口变更后重新生成前端类型 | `cd frontend && npm run gen:api` |

## 认证设计要点

- 服务端 Session：Cookie 里是 256 位随机 token（`HttpOnly`、`SameSite=Lax`，生产环境 `Secure`），数据库只存 SHA-256；活跃用户的会话滑动续期 30 天
- CSRF：写请求的 `Origin` 头必须等于前端地址（`app/core/csrf.py`）
- 邮件链接里的 token 放在 URL 片段（`#token=`），不会出现在服务器访问日志里；发送成功后 outbox 里的 payload 会被清空
- 邮件走 transactional outbox：业务代码在同一事务里写 `email_outbox`，worker 用 `FOR UPDATE SKIP LOCKED` 领取并发送，失败指数退避重试
- 限流存在 Postgres（`rate_limit_events`）：登录失败按邮箱和 IP、注册按 IP、找回密码按 IP 和邮箱
- 「忘记密码」对未注册邮箱返回同样的响应；登录失败不区分邮箱不存在还是密码错误，且两种情况耗时一致

## 约定

- 路由文件（`frontend/src/routes/`）只放路由定义，页面组件放在 `src/features/<模块>/`
- 界面文案都写在 `src/i18n/locales/zh-CN.ts`，组件里用 `t('...')`（key 有类型检查）
- 后端错误统一返回 `{code, message}`，前端按 `code` 显示本地化文案（`src/lib/api-error.ts`）
- `src/components/ui/` 是 shadcn 生成的组件，不做格式化，需要时用 `npx shadcn@latest add` 更新
- 后端按模块组织：`app/<模块>/{router,service,models,schemas}.py`，新模型要在 `app/models.py` 里导入
- `openapi.json` 和 `src/lib/api-schema.d.ts` 是生成文件，但要提交；CI 会检查它们和后端是否同步
- TypeScript 暂时固定在 5.9：TS 7 不再提供 JS 编译器 API，`openapi-typescript` 等工具还没适配
