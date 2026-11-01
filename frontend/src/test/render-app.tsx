import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { createApp } from '@/app'
import type { User } from '@/features/auth/api'
import type { Label } from '@/features/labels/api'
import type { Project } from '@/features/projects/api'
import type { Task } from '@/features/tasks/api'

type Params = Record<string, string>
type Handler = (request: Request, params: Params) => Response | Promise<Response>

/** 路由 key 形如 "PATCH /api/v1/tasks/:id"，:id 匹配任意一段路径 */
function matchRoute(pattern: string, key: string): Params | null {
  const a = pattern.split('/')
  const b = key.split('/')
  if (a.length !== b.length) return null
  const params: Params = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return params
}

/**
 * 用路由表 mock 掉 fetch。key 形如 "POST /api/v1/auth/login"，也可以带参数 "DELETE /api/v1/tasks/:id"。
 * 没有配置的接口返回 500，测试里一眼就能看出漏了什么。
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; query: URLSearchParams; body: unknown }[] = []
  const fetchMock = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    const key = `${request.method} ${url.pathname}`
    const text = await request.clone().text()
    calls.push({ key, query: url.searchParams, body: text ? JSON.parse(text) : undefined })
    // 精确匹配优先，其次是带参数的路由
    if (routes[key]) return routes[key](request, {})
    for (const [pattern, handler] of Object.entries(routes)) {
      const params = matchRoute(pattern, key)
      if (params) return handler(request, params)
    }
    return Response.json({ code: 'unknown', message: `unmocked ${key}` }, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, callsTo: (key: string) => calls.filter((c) => c.key === key) }
}

export function renderApp(path: string) {
  const app = createApp(createMemoryHistory({ initialEntries: [path] }))
  render(<app.App />)
  return app
}

export const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status })
export const empty =
  (status = 204) =>
  () =>
    new Response(null, { status })
export const apiError = (status: number, code: string) => () =>
  Response.json({ code, message: code }, { status })

export const alice: User = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  display_name: 'Alice',
  email_verified: false,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  created_at: '2026-10-31T00:00:00Z',
}

export const inbox: Project = {
  id: '10000000-0000-0000-0000-000000000000',
  name: 'Inbox',
  color: 'gray',
  is_inbox: true,
  archived: false,
  open_task_count: 0,
  done_task_count: 0,
  created_at: '2026-10-31T00:00:00Z',
}

export function makeProject(overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return { ...inbox, is_inbox: false, ...overrides }
}

export function makeLabel(overrides: Partial<Label> & Pick<Label, 'id' | 'name'>): Label {
  return { color: 'gray', created_at: '2026-10-31T00:00:00Z', ...overrides }
}

export function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    project_id: inbox.id,
    description: '',
    status: 'todo',
    priority: 4,
    due_date: null,
    due_time: null,
    label_ids: [],
    sort_key: 'a0',
    completed_at: null,
    created_at: '2026-10-31T00:00:00Z',
    updated_at: '2026-10-31T00:00:00Z',
    ...overrides,
  }
}

/** 已登录状态下应用壳需要的接口（当前用户、项目、标签、空的任务列表），可以逐个覆盖 */
export function signedIn(routes: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /api/v1/auth/me': json(alice),
    'GET /api/v1/projects': json([inbox]),
    'GET /api/v1/labels': json([]),
    'GET /api/v1/tasks': json([]),
    ...routes,
  }
}

/** 暂缓某个接口的响应，用来断言「请求还没返回时」界面的乐观更新 */
export function held(handler: Handler) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  return {
    handler: async (request: Request, params: Params) => {
      await gate
      return handler(request, params)
    },
    release,
  }
}

/**
 * 内存里的假后端：任务和标签的增删改会真的改变数据，之后重新拉取列表时能拿到新状态
 * （和真实后端一样），项目上的计数也由任务实时算出。列表的筛选和排序按后端的规则另写一份，
 * 不复用前端代码，这样才能检验前端的乐观更新和服务端结果是否一致。
 */
export function fakeBackend({
  projects,
  tasks,
  labels = [],
}: {
  projects: Project[]
  tasks: Task[]
  labels?: Label[]
}) {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]))
  const labelStore = new Map(labels.map((l) => [l.id, { ...l }]))
  const deleted = new Set<string>()
  let seq = 0
  const visible = () => [...store.values()].filter((t) => !deleted.has(t.id))
  const notFound = () => Response.json({ code: 'task_not_found', message: '' }, { status: 404 })
  const cmp = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1

  const routes: Record<string, Handler> = {
    'GET /api/v1/projects': () =>
      Response.json(
        projects.map((p) => {
          const own = visible().filter((t) => t.project_id === p.id)
          return {
            ...p,
            open_task_count: own.filter((t) => t.status !== 'done').length,
            done_task_count: own.filter((t) => t.status === 'done').length,
          }
        }),
      ),
    'GET /api/v1/labels': () =>
      Response.json([...labelStore.values()].sort((a, b) => a.name.localeCompare(b.name))),
    'POST /api/v1/labels': async (request) => {
      const body = (await request.json()) as { name: string; color?: Label['color'] }
      const label = makeLabel({ id: `l-new-${++seq}`, name: body.name, color: body.color })
      labelStore.set(label.id, label)
      return Response.json(label, { status: 201 })
    },
    'DELETE /api/v1/labels/:id': (_request, { id }) => {
      if (!labelStore.delete(id)) {
        return Response.json({ code: 'label_not_found', message: '' }, { status: 404 })
      }
      // 和后端一样：任务保留，只是去掉这个标签
      for (const task of store.values()) task.label_ids = task.label_ids.filter((l) => l !== id)
      return new Response(null, { status: 204 })
    },
    'GET /api/v1/tasks': (request) => {
      const q = new URL(request.url).searchParams
      const projectId = q.get('project_id')
      const labelId = q.get('label_id')
      const dueFrom = q.get('due_from')
      const dueTo = q.get('due_to')
      const done = q.get('done') === 'true'
      const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id))
      const list = visible()
        .filter((t) => (t.status === 'done') === done)
        .filter((t) => (projectId ? t.project_id === projectId : !archived.has(t.project_id)))
        .filter((t) => !labelId || t.label_ids.includes(labelId))
        .filter((t) => !dueFrom || (t.due_date !== null && t.due_date >= dueFrom))
        .filter((t) => !dueTo || (t.due_date !== null && t.due_date <= dueTo))
        .sort((a, b) =>
          projectId
            ? cmp(a.sort_key, b.sort_key)
            : cmp(a.due_date, b.due_date) ||
              cmp(a.due_time, b.due_time) ||
              a.priority - b.priority ||
              cmp(a.created_at, b.created_at),
        )
      return Response.json(list)
    },
    'GET /api/v1/tasks/:id': (_request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      return Response.json(task)
    },
    'POST /api/v1/tasks': async (request) => {
      const body = (await request.json()) as Partial<Task> & { title: string; project_id: string }
      const task = makeTask({
        id: `t-new-${++seq}`,
        title: body.title,
        project_id: body.project_id,
        priority: body.priority ?? 4,
        due_date: body.due_date ?? null,
        due_time: body.due_time ?? null,
        label_ids: body.label_ids ?? [],
        sort_key: `z${seq}`,
        created_at: new Date().toISOString(),
      })
      store.set(task.id, task)
      return Response.json(task, { status: 201 })
    },
    'PATCH /api/v1/tasks/:id': async (request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      const patch = (await request.json()) as Partial<Task>
      Object.assign(task, patch)
      // 和后端一样：改截止日期时没带时间就是全天
      if ('due_date' in patch) task.due_time = patch.due_time ?? null
      if (patch.status)
        task.completed_at = patch.status === 'done' ? new Date().toISOString() : null
      return Response.json(task)
    },
    'DELETE /api/v1/tasks/:id': (_request, { id }) => {
      if (!store.has(id) || deleted.has(id)) return notFound()
      deleted.add(id)
      return new Response(null, { status: 204 })
    },
    'POST /api/v1/tasks/:id/restore': (_request, { id }) => {
      if (!deleted.delete(id)) return notFound()
      return Response.json(store.get(id))
    },
  }
  return { routes, task: (id: string) => store.get(id), label: (id: string) => labelStore.get(id) }
}
