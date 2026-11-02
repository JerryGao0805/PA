# 个人助手

以任务管理为核心的个人助手 Web 应用。需求与架构见 [docs/plan.md](docs/plan.md)。

- 前端：Vite + React + TypeScript + TanStack Router/Query + Tailwind CSS（`frontend/`）
- 后端：FastAPI + SQLAlchemy 2.0 + PostgreSQL（`backend/`）

## 本地开发

需要：Docker、Node 22+、[uv](https://docs.astral.sh/uv/)。

```bash
# 1. 启动 Postgres（5433）和 Mailpit（SMTP 1026，Web UI http://localhost:8026）
docker compose up -d

# 2. 后端：所有接口都在 /api 下，根路径 / 没有路由（返回 404 是正常的）
#    API 文档 http://localhost:8001/api/docs，健康检查 http://localhost:8001/api/v1/health
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

VS Code 调试：在仓库根目录打开 VS Code，「运行和调试」面板里有 API、worker、前端（Vite + Chrome）、pytest、Vitest 几个配置，「全栈」会一次启动前三个（`.vscode/launch.json`）。

数据库：开发用 `pa`，pytest 用 `pa_test`，E2E 用 `pa_e2e`，都在同一个 Postgres 容器里。

## 常用命令

| 目的 | 命令 |
|---|---|
| 后端测试 | `cd backend && uv run pytest` |
| 后端 lint / 格式 / 类型 | `uv run ruff check . && uv run ruff format . && uv run mypy app scripts tests` |
| 新建数据库迁移 | `cd backend && uv run alembic revision --autogenerate -m "描述"` |
| 前端测试 | `cd frontend && npm test` |
| 前端 lint / 格式 / 类型 | `npm run lint && npm run format && npm run typecheck` |
| 端到端测试（需先 `docker compose up -d`） | `cd frontend && npm run e2e`（自动启动 API、worker 和前端；用独立的库 `pa_e2e` 和端口 8002/5174，每次运行前清空重建，不影响开发环境） |
| 后端接口变更后重新生成前端类型 | `cd frontend && npm run gen:api` |

## 认证设计要点

- 服务端 Session：Cookie 里是 256 位随机 token（`HttpOnly`、`SameSite=Lax`，生产环境 `Secure`），数据库只存 SHA-256；活跃用户的会话滑动续期 30 天
- CSRF：写请求的 `Origin` 头必须等于前端地址（`app/core/csrf.py`）
- 邮件链接里的 token 放在 URL 片段（`#token=`），不会出现在服务器访问日志里；发送成功后 outbox 里的 payload 会被清空
- 邮件走 transactional outbox：业务代码在同一事务里写 `email_outbox`，worker 用 `FOR UPDATE SKIP LOCKED` 领取并发送，失败指数退避重试
- 限流存在 Postgres（`rate_limit_events`）：登录失败按邮箱和 IP、注册按 IP、找回密码按 IP 和邮箱
- 「忘记密码」对未注册邮箱返回同样的响应；登录失败不区分邮箱不存在还是密码错误，且两种情况耗时一致

## 任务设计要点

- 多用户隔离两层：接口层所有查询都带 `user_id`，访问别人的数据一律 404；数据库层任务→项目、任务标签→任务/标签都用带 `user_id` 的复合外键，代码漏了检查也挂不到别人的数据上
- 排序用 fractional indexing（`app/core/ordering.py`），`sort_key` 列是 `COLLATE "C"`（按字节比较），拖拽时只改一行
- 删除任务是软删除，可以撤销；worker 30 天后永久清除。删除项目是永久删除（会先确认）
- 截止日期是「日历日期 + 可选的时间」（`DATE` + `TIME`），按用户设置的时区理解，不做时区换算。「今天」由前端按用户时区算出后传给后端（`GET /tasks?due_to=…`），后端不依赖服务器时间
- 「今天」「即将到来」、标签页是跨项目的列表：不含已归档项目里的任务，按截止日期、时间、优先级排序
- 前端每种筛选条件是一个独立的缓存；写操作时按同样的规则判断任务该出现在哪些列表里（`src/features/tasks/api.ts`），先改界面再发请求，失败回滚
- 任务详情面板由 URL 参数 `?task=<id>` 控制，可以直接分享、刷新，浏览器后退即关闭

## 约定

- 路由文件（`frontend/src/routes/`）只放路由定义，页面组件放在 `src/features/<模块>/`
- 界面文案都写在 `src/i18n/locales/zh-CN.ts`，组件里用 `t('...')`（key 有类型检查）
- 后端错误统一返回 `{code, message}`，前端按 `code` 显示本地化文案（`src/lib/api-error.ts`）
- `src/components/ui/` 是 shadcn 生成的组件，不做格式化，需要时用 `npx shadcn@latest add` 更新
- 后端按模块组织：`app/<模块>/{router,service,models,schemas}.py`，新模型要在 `app/models.py` 里导入
- `openapi.json` 和 `src/lib/api-schema.d.ts` 是生成文件，但要提交；CI 会检查它们和后端是否同步
- TypeScript 暂时固定在 5.9：TS 7 不再提供 JS 编译器 API，`openapi-typescript` 等工具还没适配
