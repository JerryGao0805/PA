import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { generateKeyBetween } from 'fractional-indexing'

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

/**
 * 列表里每一项的标题（有链接就取链接的文字）。默认只算读屏软件能看到的；详情面板打开时
 * Radix 会给面板外的内容加上 aria-hidden，这时要带上 hidden 才能找到
 */
export const titlesIn = (container: HTMLElement, { hidden = false } = {}) =>
  within(container)
    .queryAllByRole('listitem', { hidden })
    .map((li) => (within(li).queryByRole('link', { hidden }) ?? li).textContent)

/** 某条 toast 里的「撤销」按钮 */
export const undoIn = async (message: string) =>
  within((await screen.findByText(message)).closest('li')!).getByRole('button', { name: '撤销' })

/**
 * jsdom 不做布局，所有元素的位置都是 0，而 dnd-kit 的键盘拖拽要靠位置找方向键指向的目标。
 * 这里给出一个假的布局：看板的列从左到右排开（每列 300px 宽）；列表项（包括看板列里的卡片）
 * 按顺序从上到下排开（每行 50px）。拖动时跟着走的浮层（DragOverlay）用 dnd-kit 写在它上面的
 * 位置和大小，有浮层时碰撞检测用的是它
 */
export function mockLayout() {
  const original = Element.prototype.getBoundingClientRect
  const rect = (left: number, top: number, width: number, height: number) => ({
    ...{ x: left, y: top, left, top, width, height },
    ...{ right: left + width, bottom: top + height, toJSON: () => ({}) },
  })
  const indexIn = (el: Element) => Array.from(el.parentElement?.children ?? []).indexOf(el)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const overlay = this.closest<HTMLElement>('[style*="position: fixed"]')
    if (overlay?.style.width) {
      const { left, top, width, height } = overlay.style
      return rect(parseFloat(left), parseFloat(top), parseFloat(width), parseFloat(height))
    }
    const column = this.closest('section[aria-labelledby^="board-column-"]')
    const left = column ? indexIn(column) * 300 : 0
    if (this === column) return rect(left, 0, 280, 600)
    if (this.tagName === 'LI') return rect(left, (column ? 40 : 0) + indexIn(this) * 50, 280, 44)
    return original.call(this)
  })
}

/** 聚焦拖拽的把手（标题链接），用键盘拿起、按方向键、放下 */
export async function keyboardDrag(handle: HTMLElement, keys: string[]) {
  const user = userEvent.setup()
  handle.focus()
  await user.keyboard('[Space]')
  for (const key of keys) await user.keyboard(`[${key}]`)
  await user.keyboard('[Space]')
  return user
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
  layout: 'list',
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
    parent_id: null,
    description: '',
    status: 'todo',
    priority: 4,
    due_date: null,
    due_time: null,
    label_ids: [],
    subtask_count: 0,
    done_subtask_count: 0,
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
 * （和真实后端一样），项目上的计数也由任务实时算出。列表的筛选、排序和子任务的连带规则
 * 按后端另写一份，不复用前端代码，这样才能检验前端的乐观更新和服务端结果是否一致。
 * 测试数据里的 sort_key 要是合法的 key（'a0'、'a1' 这样），拖拽排序时要用它们生成新 key。
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
  // 项目按数组顺序返回（收件箱在最前）；拖拽排序时直接调整顺序。
  // 复制一份，修改时不影响测试里共用的数据（例如 inbox）
  projects = projects.map((p) => ({ ...p }))
  const store = new Map(tasks.map((t) => [t.id, { ...t }]))
  const labelStore = new Map(labels.map((l) => [l.id, { ...l }]))
  // 删除时间（id → 序号），恢复父任务时据此找回一起删除的子任务
  const deleted = new Map<string, number>()
  let seq = 0
  const visible = () => [...store.values()].filter((t) => !deleted.has(t.id))
  const notFound = () => Response.json({ code: 'task_not_found', message: '' }, { status: 404 })
  const cmp = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1
  const childrenOf = (id: string) => [...store.values()].filter((t) => t.parent_id === id)
  const withCounts = (task: Task): Task => {
    const children = childrenOf(task.id).filter((t) => !deleted.has(t.id))
    return {
      ...task,
      subtask_count: children.length,
      done_subtask_count: children.filter((t) => t.status === 'done').length,
    }
  }
  // 同一个排序范围（同一项目的顶层任务，或同一父任务的子任务），包括已完成和已删除的
  const siblings = (task: Pick<Task, 'project_id' | 'parent_id'>) =>
    [...store.values()].filter((t) =>
      task.parent_id
        ? t.parent_id === task.parent_id
        : t.project_id === task.project_id && !t.parent_id,
    )
  const keyAtEnd = (scope: Pick<Task, 'project_id' | 'parent_id'>) => {
    const keys = siblings(scope).map((t) => t.sort_key)
    return generateKeyBetween(keys.length ? keys.reduce((a, b) => (a > b ? a : b)) : null, null)
  }
  const setStatus = (task: Task, status: Task['status']) => {
    const wasDone = task.status === 'done'
    const completedAt = task.completed_at
    const now = new Date(Date.now() + seq++).toISOString()
    task.status = status
    task.completed_at = status === 'done' ? now : null
    if (task.parent_id) {
      const parent = store.get(task.parent_id)
      if (wasDone && parent?.status === 'done')
        Object.assign(parent, { status: 'todo', completed_at: null })
      return
    }
    for (const child of childrenOf(task.id).filter((t) => !deleted.has(t.id))) {
      if (status === 'done' && child.status !== 'done') {
        Object.assign(child, { status: 'done', completed_at: now })
      } else if (wasDone && status !== 'done' && child.completed_at === completedAt) {
        Object.assign(child, { status: 'todo', completed_at: null })
      }
    }
  }

  const routes: Record<string, Handler> = {
    'GET /api/v1/projects': () =>
      Response.json(
        projects.map((p) => {
          const own = visible().filter((t) => t.project_id === p.id && !t.parent_id)
          return {
            ...p,
            open_task_count: own.filter((t) => t.status !== 'done').length,
            done_task_count: own.filter((t) => t.status === 'done').length,
          }
        }),
      ),
    'PATCH /api/v1/projects/:id': async (request, { id }) => {
      const project = projects.find((p) => p.id === id)
      if (!project)
        return Response.json({ code: 'project_not_found', message: '' }, { status: 404 })
      const patch = (await request.json()) as Partial<Project>
      // 收件箱只能改 layout
      if (project.is_inbox && Object.keys(patch).some((k) => k !== 'layout')) {
        return Response.json({ code: 'inbox_immutable', message: '' }, { status: 400 })
      }
      Object.assign(project, patch)
      return Response.json(project)
    },
    'POST /api/v1/projects/:id/move': async (request, { id }) => {
      const project = projects.find((p) => p.id === id)
      if (!project)
        return Response.json({ code: 'project_not_found', message: '' }, { status: 404 })
      const { after_id } = (await request.json()) as { after_id: string | null }
      projects = projects.filter((p) => p.id !== id)
      const index = after_id
        ? projects.findIndex((p) => p.id === after_id) + 1
        : projects.findIndex((p) => !p.is_inbox)
      projects.splice(index < 0 ? projects.length : index, 0, project)
      return Response.json(project)
    },
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
      const parentId = q.get('parent_id')
      if (parentId && (!store.has(parentId) || deleted.has(parentId))) return notFound()
      const labelId = q.get('label_id')
      const dueFrom = q.get('due_from')
      const dueTo = q.get('due_to')
      const done = q.get('done') === 'true'
      const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id))
      const list = visible()
        .filter((t) => (t.status === 'done') === done)
        .filter((t) => !parentId || t.parent_id === parentId)
        .filter((t) =>
          projectId
            ? t.project_id === projectId && (parentId || !t.parent_id)
            : parentId || !archived.has(t.project_id),
        )
        .filter((t) => !labelId || t.label_ids.includes(labelId))
        .filter((t) => !dueFrom || (t.due_date !== null && t.due_date >= dueFrom))
        .filter((t) => !dueTo || (t.due_date !== null && t.due_date <= dueTo))
        .sort((a, b) =>
          done
            ? cmp(b.completed_at, a.completed_at)
            : projectId || parentId
              ? cmp(a.sort_key, b.sort_key)
              : cmp(a.due_date, b.due_date) ||
                cmp(a.due_time, b.due_time) ||
                a.priority - b.priority ||
                cmp(a.created_at, b.created_at),
        )
      return Response.json(list.map(withCounts))
    },
    'GET /api/v1/tasks/:id': (_request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      return Response.json(withCounts(task))
    },
    'POST /api/v1/tasks': async (request) => {
      const body = (await request.json()) as Partial<Task> & { title: string; project_id: string }
      const parent = body.parent_id ? store.get(body.parent_id) : undefined
      if (parent && (parent.parent_id || parent.status === 'done')) {
        return Response.json({ code: 'invalid_parent', message: '' }, { status: 400 })
      }
      const scope = {
        project_id: parent?.project_id ?? body.project_id,
        parent_id: parent?.id ?? null,
      }
      const task = makeTask({
        id: `t-new-${++seq}`,
        title: body.title,
        ...scope,
        status: body.status ?? 'todo',
        priority: body.priority ?? 4,
        due_date: body.due_date ?? null,
        due_time: body.due_time ?? null,
        label_ids: body.label_ids ?? [],
        sort_key: keyAtEnd(scope),
        created_at: new Date().toISOString(),
      })
      store.set(task.id, task)
      return Response.json(task, { status: 201 })
    },
    'PATCH /api/v1/tasks/:id': async (request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      const { status, project_id, ...patch } = (await request.json()) as Partial<Task>
      Object.assign(task, patch)
      // 和后端一样：改截止日期时没带时间就是全天
      if ('due_date' in patch) task.due_time = patch.due_time ?? null
      if (status && status !== task.status) setStatus(task, status)
      if (project_id && project_id !== task.project_id) {
        // 子任务单独移走后变成顶层任务；父任务的子任务跟着移动
        const sortKey = keyAtEnd({ project_id, parent_id: null })
        Object.assign(task, { project_id, parent_id: null, sort_key: sortKey })
        for (const child of childrenOf(task.id)) child.project_id = project_id
      }
      return Response.json(withCounts(task))
    },
    'POST /api/v1/tasks/:id/move': async (request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      const { after_id, status } = (await request.json()) as {
        after_id: string | null
        status?: Task['status']
      }
      if (status && status !== task.status) setStatus(task, status)
      const lower = (after_id ? store.get(after_id)?.sort_key : null) ?? null
      const others = siblings(task).filter((t) => t.id !== id)
      // 目标列：看板上是同一状态的，列表里是所有未完成的
      const upper = others
        .filter((t) => !deleted.has(t.id) && (status ? t.status === status : t.status !== 'done'))
        .map((t) => t.sort_key)
        .filter((k) => lower === null || k > lower)
        .sort()[0]
      const key = task.sort_key
      // 已经在这个位置上就不改；否则紧挨着上一个（放到最前时紧挨着目标列的第一个）
      if ((lower !== null && key <= lower) || (upper !== undefined && key >= upper)) {
        const keys = others.map((t) => t.sort_key).sort()
        task.sort_key =
          lower !== null
            ? generateKeyBetween(lower, keys.find((k) => k > lower) ?? null)
            : generateKeyBetween(keys.filter((k) => k < upper!).pop() ?? null, upper!)
      }
      return Response.json(withCounts(task))
    },
    'DELETE /api/v1/tasks/:id': (_request, { id }) => {
      const task = store.get(id)
      if (!task || deleted.has(id)) return notFound()
      const at = ++seq
      deleted.set(id, at)
      if (!task.parent_id) {
        for (const child of childrenOf(id)) if (!deleted.has(child.id)) deleted.set(child.id, at)
      }
      return new Response(null, { status: 204 })
    },
    'POST /api/v1/tasks/:id/restore': (_request, { id }) => {
      const task = store.get(id)
      const at = deleted.get(id)
      if (!task || at === undefined) return notFound()
      deleted.delete(id)
      for (const child of childrenOf(id)) if (deleted.get(child.id) === at) deleted.delete(child.id)
      return Response.json(withCounts(task))
    },
  }
  return {
    routes,
    task: (id: string) => store.get(id),
    label: (id: string) => labelStore.get(id),
    project: (id: string) => projects.find((p) => p.id === id),
  }
}
