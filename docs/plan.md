# 个人助手 Web App：需求与架构方案

## Context

从零开始做一个**以任务/待办管理为核心**的个人助手 Web 应用（项目目录目前为空）。目标同时有三个：自己每天用、借机学技术（React + Python）、以后能做成面向海外用户的多用户产品。下面的范围和技术选型都来自访谈结论。

### 访谈结论速览
| 维度 | 决定 |
|---|---|
| 核心功能 | 任务管理：清单/项目、标签+优先级、看板、子任务、截止日期、提醒、日历视图 |
| 用户 | 多用户产品，**纯个人使用**（不做协作），数据按用户隔离 |
| AI | 暂不引入 |
| 设备 | 桌面 + 手机，响应式布局 |
| 技术栈 | React（前端）+ Python FastAPI（后端） |
| 认证 | **自己实现**：邮箱+密码、邮箱验证、找回密码 |
| 邮件 | AWS SES |
| 部署 | 自己的 VPS（Docker Compose） |
| 语言/地区 | 中英双语，海外为主（双语放第二阶段） |
| 离线 | 不需要（用乐观更新保证操作流畅） |
| 设计 | 简洁克制，参考 Things 3 / Linear |
| 商业 | 先免费，数据模型不堵死以后的扩展 |

---

## 产品范围与分期

### MVP（第一阶段）
1. **账户**：注册、登录、登出、邮箱验证、忘记/重置密码、修改密码、设置时区、**删除账户**（面向海外用户，GDPR 需要）
2. **项目（清单）**：每个用户自动有一个「收件箱」，可增删改、排序、归档、设颜色
3. **任务**：标题、Markdown 描述、优先级 P1–P4、截止日期（可选具体时间）、标签（多对多）、**子任务**（一层，用 `parent_id` 实现）、完成/撤销、软删除 + 撤销提示
4. **智能视图**：收件箱 / 今天（含逾期）/ 即将到来（未来 7 天）/ 按项目 / 按标签 / 按优先级筛选
5. **看板视图**：项目可在「列表 ⇄ 看板」间切换；列 = 状态（待办 / 进行中 / 已完成），支持跨列拖拽和列内排序
6. **快速添加 + 智能解析**：输入 `明天下午3点 交报告 #工作 @重要 !p1` 自动识别日期、项目、标签、优先级；识别到的片段实时高亮，可点击取消识别
7. **响应式布局**：手机上侧边栏变成抽屉，看板可横向滑动
8. **键盘快捷键**：`Q` 快速添加，`Cmd/Ctrl+K` 搜索/跳转

### 第二阶段
- 日历视图（周/月，拖拽改日期）
- 邮件提醒（按任务设置提前量，例如准时 / 提前 15 分钟 / 提前 1 天）
- 中英双语切换（含邮件模板）
- 数据导出（JSON）

### 待定池（以后再说）
重复任务、Web Push / PWA、Google OAuth、两步验证（TOTP）、自定义看板列、每日摘要邮件、AI 能力、订阅收费

---

## 技术架构

```
浏览器 ──HTTPS──▶ Caddy（自动 TLS，托管前端静态文件，/api 反向代理）
                    │
                    ├─▶ api     (FastAPI + Uvicorn)
                    └─  worker  (同一个镜像，负责发邮件；第二阶段加上提醒)
                          │
                       PostgreSQL 17  ──▶ 每日 pg_dump 备份到 S3
                          │
                       AWS SES（邮件）
```

前端和 API **同域部署**（`app.example.com` 加 `/api`），这样不用处理 CORS，Cookie 也简单。

### 前端
- **Vite + React + TypeScript**
- 路由：TanStack Router（类型安全）
- 服务端状态：**TanStack Query**，所有写操作走乐观更新
- UI：Tailwind CSS + shadcn/ui（基于 Radix，对无障碍友好），图标用 lucide
- 拖拽：**dnd-kit**（看板、列表排序）
- 表单：react-hook-form + zod
- 日期：date-fns + date-fns-tz
- 快速添加解析：**chrono-node**（`chrono.en` 加 `chrono.zh.hans`，输入里有中文字符时先用中文解析器）
- i18n：MVP 就用 **react-i18next** 管理文案，先只出中文一套；第二阶段补英文时只需要加翻译文件
- API 类型：用 **openapi-typescript + openapi-fetch** 从 FastAPI 的 OpenAPI schema 生成 TS 类型，前后端类型自动对齐

### 后端
- **Python 3.13 + FastAPI + Pydantic v2**，用 `uv` 管理依赖
- **SQLAlchemy 2.0（async）+ asyncpg + Alembic** 做迁移
- 密码哈希：**argon2-cffi**（argon2id）
- 邮件：`EmailSender` 抽象层，三种实现：`SesEmailSender`（boto3）、`SmtpEmailSender`（开发时接 Mailpit）、`ConsoleEmailSender`（测试用）
- 后台任务：**基于 Postgres 的 outbox + 轮询 worker**。worker 每隔几秒用 `SELECT … FOR UPDATE SKIP LOCKED` 取待发邮件，失败按退避重试。不引入 Redis/Celery，组件少、行为可靠；第二阶段的提醒复用同一套机制
- 限流：MVP 只给认证接口限流（按 IP + 邮箱统计失败次数，存在 Postgres），不额外引入 Redis
- 代码质量：ruff（lint + format）、mypy/pyright

### 自研认证设计
- **服务端 Session**，不用 JWT：登录后生成 32 字节随机 token，存进 `HttpOnly; Secure; SameSite=Lax` Cookie，数据库只存 token 的 SHA-256 哈希。好处是能随时吊销，也能做「退出所有设备」
- 有效期滑动续期（例如 30 天）
- **CSRF**：同域 + `SameSite=Lax`，并在所有写请求上校验 `Origin` 头
- **邮箱验证 / 重置密码**：一次性随机 token，只存哈希；验证 token 24 小时过期，重置 token 1 小时过期；重置密码后吊销该用户所有 session
- **防账号枚举**：「忘记密码」无论邮箱是否存在都返回同样的响应
- 未验证邮箱的用户可以登录使用，但页面顶部提示去验证；第二阶段的提醒邮件只发给已验证的邮箱
- 不同字符串的比较一律用 `hmac.compare_digest`

### 数据模型（核心表）
- `users`：id (UUID)、email (citext, unique)、password_hash、email_verified_at、display_name、locale、timezone、created_at
- `sessions`：id、user_id、token_hash、expires_at、last_seen_at、user_agent、ip
- `email_tokens`：id、user_id、purpose (verify/reset)、token_hash、expires_at、used_at
- `email_outbox`：id、to、template、payload (jsonb)、status、attempts、next_attempt_at
- `projects`：id、user_id、name、color、is_inbox、sort_key、archived_at
- `tasks`：id、user_id、project_id、parent_id、title、description、status (todo/in_progress/done)、priority (1–4)、due_date (DATE)、due_time (TIME, 可空)、sort_key、completed_at、deleted_at、created_at、updated_at
- `labels`、`task_labels`：多对多

几个关键约定：
- **日期和时区**：截止日期存成 `DATE` + 可空的 `TIME`，按 `users.timezone` 解释。全天任务不会因为时区换算跑到前一天或后一天。时间戳一律用 `timestamptz`（UTC）
- **排序**：用 fractional indexing（字符串 `sort_key`，LexoRank 的思路），拖拽时只改一行，不需要给整列重新编号
- **数据隔离**：所有查询都经过一个依赖注入的 `current_user` 并强制带上 `user_id` 过滤，再用测试覆盖越权访问

### API（REST，`/api/v1`）
- `auth/`：register、login、logout、me、verify-email、resend-verification、forgot-password、reset-password、change-password
- `projects/`、`labels/`：CRUD + 排序
- `tasks/`：CRUD，通过查询参数筛选（`view=today|upcoming`、`project_id`、`label_id`、`priority`）；`PATCH /tasks/{id}/move` 处理拖拽（改 status 和 sort_key）
- `account/`：修改设置、删除账户

### 仓库结构（monorepo）
```
personal-assistant/
├── frontend/            # Vite + React
│   └── src/{routes,features/{auth,tasks,projects,board,quick-add},components/ui,lib}
├── backend/
│   ├── app/{core,auth,projects,tasks,labels,email,account}/  # 每个模块包含 router/service/models/schemas
│   ├── app/main.py, app/worker.py
│   ├── alembic/
│   └── tests/
├── deploy/              # docker-compose.prod.yml、Caddyfile、备份脚本
├── docker-compose.yml   # 开发环境：postgres + mailpit
└── .github/workflows/   # CI：lint、测试、构建镜像并推到 GHCR，再 SSH 部署
```

---

## MVP 实施里程碑

| # | 里程碑 | 内容 |
|---|---|---|
| M0 | 脚手架 | monorepo、开发用 docker compose（Postgres + Mailpit）、FastAPI 健康检查、Vite 应用、OpenAPI 类型生成脚本、CI |
| M1 | 认证 | 用户/会话/token 表，注册登录全流程，outbox + worker，SES/SMTP sender，前端认证页面和路由守卫 |
| M2 | 任务核心 | 项目/任务/标签/子任务 CRUD，自动创建收件箱，智能视图，列表视图拖拽排序，乐观更新 |
| M3 | 看板 | 看板视图、dnd-kit 跨列拖拽、`move` 接口 |
| M4 | 快速添加 | chrono-node 解析器（中英文）+ `#项目 @标签 !p1` 语法 + 高亮预览 + 快捷键；解析器单测要充分 |
| M5 | 打磨上线 | 移动端适配、设置页（时区、改密码、删账户）、生产环境 compose + Caddy、数据库备份、Sentry 错误监控、SES 生产权限 |

**提前要办的事**：AWS SES 新账号默认在沙盒里，只能给验证过的地址发信。要尽早申请生产权限，并给域名配好 DKIM / SPF / DMARC，否则注册邮件发不出去或者进垃圾箱。另外需要准备一个域名。

---

## 验证方式

- **后端**：pytest + httpx `AsyncClient`，连接一个独立的测试 Postgres。重点覆盖：认证全流程、token 过期和重复使用、限流、**跨用户越权访问必须返回 404**、排序 key 的生成
- **前端**：Vitest + Testing Library；快速添加解析器做表驱动测试（中英文、相对日期、各种 token 组合）
- **E2E**：Playwright 跑主流程：注册 → 从 Mailpit API 取验证链接 → 验证 → 快速添加任务 → 在看板里拖到「进行中」→ 刷新后状态仍在 → 退出
- **手动验收**：本地 `docker compose up` 后，在桌面浏览器和手机（同一局域网或 ngrok）上各走一遍；上线后在真实 SES 环境测一次找回密码
