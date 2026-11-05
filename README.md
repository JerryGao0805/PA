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
- 限流存在 Postgres（`rate_limit_events`）：登录失败按邮箱和 IP、注册按 IP、找回密码按 IP 和邮箱；已登录时输错密码（改密码、删除账户）按用户，15 分钟 5 次，防止拿到会话的人借这两个接口猜密码
- 设置页（`src/features/settings/`）：改昵称和时区（`PATCH /account`）；修改密码后其他设备全部下线，已经发出、还没用过的重置密码链接也作废；删除账户（`POST /account/delete`，要输入密码）立即永久删除，数据由外键 `ON DELETE CASCADE` 一起删掉，发件箱里发给这个地址的邮件（不关联用户）单独删
- 「忘记密码」对未注册邮箱返回同样的响应；登录失败不区分邮箱不存在还是密码错误，且两种情况耗时一致

## 任务设计要点

- 多用户隔离两层：接口层所有查询都带 `user_id`，访问别人的数据一律 404；数据库层任务→项目、任务标签→任务/标签都用带 `user_id` 的复合外键，代码漏了检查也挂不到别人的数据上
- 排序用 fractional indexing（`app/core/ordering.py`），`sort_key` 列是 `COLLATE "C"`（按字节比较），拖拽时只改一行。`POST /tasks/{id}/move`、`POST /projects/{id}/move` 只传「放在谁后面」（`after_id`），后一个由服务端从数据库里找（包括已完成、已删除、已归档的），前端看不到的行不会和新 key 冲突。前端用同一个算法的 npm 包（`fractional-indexing`）按同样的规则乐观地算出新位置（看板上参照整个列表，不只是目标列），以服务端返回的为准
- 拖拽（dnd-kit，`src/components/sortable-list.tsx`，看板是多列版本）：鼠标在整行上拖动，触屏长按 250ms 后拖动，键盘聚焦标题后按空格拿起、方向键移动（看板上左右换列，上下只在本列内）。拖拽结束时浏览器会补发一次 click，要在 window 捕获阶段拦下，否则会触发链接跳转
- 子任务只有一层（`parent_id`）。复合外键 `(parent_id, project_id) → tasks(id, project_id)` 保证子任务和父任务在同一项目，`ON UPDATE CASCADE` 让父任务换项目时子任务自动跟过去。父任务完成/删除时子任务一起完成/删除，撤销时只恢复「同一时间戳」的那些；重新打开子任务会连带重新打开已完成的父任务（规则写在 `app/tasks/service.py` 开头，前端缓存按同样的规则更新）
- 项目页和项目计数只算顶层任务，子任务在详情面板里；「今天」「即将到来」、标签页里子任务和普通任务一样出现
- 看板（`src/features/board/BoardView.tsx`）：列 = 状态（待办 / 进行中 / 已完成），列表还是看板记在项目上（`projects.layout`），换设备也一样。待办和进行中两列和列表视图共用同一个 `sort_key` 顺序，每列显示其中对应状态的任务；`move` 接口带上 `status`（目标列，只能是待办或进行中）时同时改状态。放下的位置只约束任务在目标列里的先后：现在的 key 已经满足就不改，所以在看板上换列不会打乱列表里的顺序。「已完成」按完成时间排列，拖进去等于勾选完成（走 PATCH，可撤销，撤销后回到原来的状态），位置不变，重新打开后回到原处；从「已完成」拖出去又放回来什么都不做。拖到看板外面（指针不在任何一列上）松手就是取消
- 拖拽松手后 50ms 内的 click 都会被 dnd-kit 吞掉（防误触），E2E 里拖完要等一下再点别的
- 删除任务是软删除，可以撤销；worker 30 天后永久清除。删除项目是永久删除（会先确认）
- 截止日期是「日历日期 + 可选的时间」（`DATE` + `TIME`），按用户设置的时区理解，不做时区换算。「今天」由前端按用户时区算出后传给后端（`GET /tasks?due_to=…`），后端不依赖服务器时间
- 「今天」「即将到来」、标签页是跨项目的列表：不含已归档项目里的任务，按截止日期、时间、优先级排序
- 前端每种筛选条件是一个独立的缓存；写操作时按同样的规则判断任务该出现在哪些列表里（`src/features/tasks/api.ts`），先改界面再发请求，失败回滚
- 任务详情面板由 URL 参数 `?task=<id>` 控制，可以直接分享、刷新，浏览器后退即关闭
- 快速添加（`src/features/quick-add/`）：在任何页面按 `Q`（或点侧边栏的「快速添加」）打开，列表、看板、子任务的「添加任务」用的是同一个输入框。一句话里可以写：
  - 日期和时间：chrono-node 解析（输入里有中文先用中文解析器，没识别出再用英文的），另外补了 chrono 不认识的「周末」「下周」（= 下周一，和日期选择器一致；英文的 next week 也一样，后面跟着星期几时是下周的那一天，例如 next week friday）「5号」「下个月5号」「月底」「下个月底」。只有「下午」「晚上」这样的词、英文的星期 / 月份缩写不算日期（「订下午茶」「sun cream」）；跟在日期后面时算进日期，但不带时间（「周五下午」是周五）。按用户时区里的「现在」理解，时间已经过了就是下一次（下午 2 点写「上午10点」是明天）
  - `#项目`、`@标签`：只认已有的（名字最长匹配，不区分大小写；前面要是开头、空格或中文，后面要是空格、标点或结尾，所以 `a@b.com`、`C#` 不算）。输入 `#`、`@` 时列出候选，回车或 Tab 选中；名字已经输完整时回车直接提交。子任务不能用 `#` 换项目
  - `!p1`–`!p4`：优先级
  - 识别出来的部分在输入框里高亮（输入框文字透明，下面垫一层同样排版的文字来上色），下面列出每一项，可以点 × 取消识别，那一段就留在任务名称里。识别出的内容优先于页面的默认值（例如「今天」里写了「周五」就是周五到期）；加到了别的项目会提示加到了哪里
  - 解析器是纯函数（`parse.ts`），用例在 `parse.test.ts`
- 搜索（`src/features/command-palette/`）：在任何地方按 `Cmd/Ctrl+K`（或点侧边栏的「搜索」）打开，再按一次关闭。Mac 上只认 Cmd+K（Ctrl+K 是输入框的「删到行尾」），按 `navigator.platform` 判断，不看可能被伪装的 userAgent；别的对话框（快速添加、删除确认等）开着时不响应，任务详情除外。输入时在本地筛选页面、项目（包括归档的）和标签，同时请求 `GET /tasks/search?q=` 搜任务：标题或描述里包含这段文字（`ILIKE`，`%`、`_` 按字面匹配），包括已完成的、子任务和归档项目里的；未完成的在前，标题里有的在前，最多 20 条。选中任务会跳到它所在的项目并打开详情。目前没有建索引，数据量大了可以加 `pg_trgm` 的 GIN 索引

- 手机（宽度小于 768px）：侧边栏是抽屉；没有键盘快捷键，所以顶栏右边放「搜索」，右下角放「快速添加」（`src/features/app-shell/MobileActions.tsx`）；任务标题最多显示两行（桌面上一行）。`e2e/tasks.spec.ts` 里有手机尺寸的用例，检查这两个按钮、长内容不撑宽详情面板、弹层不超出屏幕、输入框字号（见下面「约定」）

## 约定

- 路由文件（`frontend/src/routes/`）只放路由定义，页面组件放在 `src/features/<模块>/`
- 界面文案都写在 `src/i18n/locales/zh-CN.ts`，组件里用 `t('...')`（key 有类型检查）
- 后端错误统一返回 `{code, message}`，前端按 `code` 显示本地化文案（`src/lib/api-error.ts`）
- `src/components/ui/` 是 shadcn 生成的组件，不做格式化，需要时用 `npx shadcn@latest add` 更新
- 手机上输入框字号不小于 16px，否则 iOS Safari 聚焦时会放大页面。shadcn 的 `Input`、`Textarea` 已经是 `text-base md:text-sm`；cmdk 的 `CommandInput` 写死了 14px，所以用 `@/components/command-input` 里包了一层的版本
- 可能比较高的弹层用 `FittedPopoverContent`（`src/components/fitted-popover.tsx`）代替 `PopoverContent`：离屏幕边缘留 8px，放不下时在弹层里滚动，手机上不会被截掉
- 后端按模块组织：`app/<模块>/{router,service,models,schemas}.py`，新模型要在 `app/models.py` 里导入
- `openapi.json` 和 `src/lib/api-schema.d.ts` 是生成文件，但要提交；CI 会检查它们和后端是否同步
- TypeScript 暂时固定在 5.9：TS 7 不再提供 JS 编译器 API，`openapi-typescript` 等工具还没适配
