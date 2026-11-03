import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import { generateKeyBetween } from 'fractional-indexing'
import { toast } from 'sonner'

import { adjustTaskCount, PROJECTS_KEY, type Project } from '@/features/projects/api'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { ApiError, errorMessage, unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Task = components['schemas']['TaskOut']
export type TaskStatus = Task['status']
export type TaskUpdate = components['schemas']['TaskUpdate']
/** 前端总是明确指定项目（收件箱也一样；子任务就是父任务的项目），这样乐观更新时知道该调整哪个计数 */
export type NewTask = components['schemas']['TaskCreate'] & { project_id: string }

/**
 * 任务列表的筛选条件，和后端 GET /tasks 的参数一一对应。
 * 每种组合是一个独立的缓存；写操作时按条件判断任务该不该出现在某个列表里。
 */
export interface TaskFilter {
  /** 项目里的顶层任务（不含子任务） */
  project_id?: string
  /** 这个任务的子任务 */
  parent_id?: string
  label_id?: string
  /** 截止日期在 [due_from, due_to] 内，含两端 */
  due_from?: string
  due_to?: string
  done?: boolean
}

const TASKS_KEY = ['tasks'] as const
const LISTS_KEY = [...TASKS_KEY, 'list'] as const
const listKey = (filter: TaskFilter) => [...LISTS_KEY, { ...filter, done: !!filter.done }] as const
const detailKey = (id: string) => [...TASKS_KEY, 'detail', id] as const
// 所有任务相关的写操作共用一个 mutationKey，用来判断是否还有别的写操作在进行
const TASK_MUTATION = [...TASKS_KEY, 'mutation'] as const

export const isDone = (task: Pick<Task, 'status'>) => task.status === 'done'

/** 「已完成」列表最多返回这么多条，和后端 DONE_LIST_LIMIT 一致 */
export const DONE_LIST_LIMIT = 100

export const tasksQuery = (filter: TaskFilter) =>
  queryOptions({
    queryKey: listKey(filter),
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks', { params: { query: { ...filter, done: !!filter.done } } })),
  })

export const taskQuery = (id: string) =>
  queryOptions({
    queryKey: detailKey(id),
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks/{task_id}', { params: { path: { task_id: id } } })),
  })

/** 项目页要用的任务：未完成的；看板还要「已完成」一列 */
export function ensureProjectTasks(queryClient: QueryClient, project: Project) {
  return Promise.all([
    queryClient.ensureQueryData(tasksQuery({ project_id: project.id })),
    project.layout === 'board' &&
      queryClient.ensureQueryData(tasksQuery({ project_id: project.id, done: true })),
  ])
}

/** 在已缓存的列表和详情里找这个任务（打开详情时先用它显示，不用等请求） */
export function findCachedTask(queryClient: QueryClient, id: string): Task | undefined {
  for (const [, list] of queryClient.getQueriesData<Task[]>({ queryKey: LISTS_KEY })) {
    const task = list?.find((t) => t.id === id)
    if (task) return task
  }
  return queryClient.getQueryData<Task>(detailKey(id))
}

/** 已缓存的这个任务的子任务（各个列表里的去重合并，不一定是全部） */
function cachedSubtasks(queryClient: QueryClient, parentId: string): Task[] {
  const found = new Map<string, Task>()
  for (const [, list] of queryClient.getQueriesData<Task[]>({ queryKey: LISTS_KEY })) {
    for (const task of list ?? []) if (task.parent_id === parentId) found.set(task.id, task)
  }
  return [...found.values()]
}

/** 还没收到服务端响应的新任务用临时 id，界面上会禁用对它的操作 */
export const isPendingTask = (task: Task) => task.id.startsWith('temp-')
// '~' 的字节值大于所有 base62 字符，临时任务因此排在末尾
const PENDING_SORT_KEY = '~'

// ---------- 列表的成员和顺序：和后端 list_tasks 的规则保持一致 ----------

function belongs(task: Task, filter: TaskFilter, archived: Set<string>): boolean {
  if (isDone(task) !== !!filter.done) return false
  if (filter.parent_id) {
    if (task.parent_id !== filter.parent_id) return false
  } else if (filter.project_id) {
    if (task.project_id !== filter.project_id || task.parent_id) return false
  } else if (archived.has(task.project_id)) {
    // 跨项目的列表不含已归档项目里的任务
    return false
  }
  if (filter.label_id && !task.label_ids.includes(filter.label_id)) return false
  if (filter.due_from && !(task.due_date && task.due_date >= filter.due_from)) return false
  if (filter.due_to && !(task.due_date && task.due_date <= filter.due_to)) return false
  return true
}

// 字节序比较，和服务端 COLLATE "C" 一致
const byBytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const nullsLast = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : byBytes(a, b)

function comparator(filter: TaskFilter): (a: Task, b: Task) => number {
  // 已完成的：新的在前
  if (filter.done) return (a, b) => byBytes(b.completed_at ?? '', a.completed_at ?? '')
  // 项目里、父任务下：手动顺序
  if (filter.project_id || filter.parent_id) return (a, b) => byBytes(a.sort_key, b.sort_key)
  // 跨项目（包括子任务）：截止日期、时间（没有的排后面）、优先级、创建时间
  return (a, b) =>
    nullsLast(a.due_date, b.due_date) ||
    nullsLast(a.due_time, b.due_time) ||
    a.priority - b.priority ||
    byBytes(a.created_at, b.created_at) ||
    byBytes(a.id, b.id)
}

// ---------- 乐观更新：直接修改缓存里的列表和计数 ----------

function archivedProjectIds(queryClient: QueryClient): Set<string> {
  const projects = queryClient.getQueryData<Project[]>(PROJECTS_KEY) ?? []
  return new Set(projects.filter((p) => p.archived).map((p) => p.id))
}

/** 从所有已缓存的列表里移除 removeId，再把 task 插入到它应该出现的列表里 */
function writeLists(queryClient: QueryClient, removeId: string, task: Task | null) {
  const archived = archivedProjectIds(queryClient)
  for (const [key, list] of queryClient.getQueriesData<Task[]>({ queryKey: LISTS_KEY })) {
    if (!list) continue
    const filter = key[2] as TaskFilter
    let next = list.filter((t) => t.id !== removeId)
    if (task && belongs(task, filter, archived)) next = [...next, task].sort(comparator(filter))
    if (next.length !== list.length || next.some((t, i) => t !== list[i])) {
      queryClient.setQueryData(key, next)
    }
  }
  if (task && !isPendingTask(task)) {
    queryClient.setQueryData<Task>(detailKey(task.id), (old) => (old ? task : old))
  }
}

/** 原地修改缓存里的这个任务（不影响它在列表里的位置，例如子任务计数） */
function updateCachedTask(queryClient: QueryClient, id: string, update: (task: Task) => Task) {
  for (const [key, list] of queryClient.getQueriesData<Task[]>({ queryKey: LISTS_KEY })) {
    if (list?.some((t) => t.id === id)) {
      queryClient.setQueryData<Task[]>(
        key,
        list.map((t) => (t.id === id ? update(t) : t)),
      )
    }
  }
  queryClient.setQueryData<Task>(detailKey(id), (old) => (old ? update(old) : old))
}

function countField(task: Task) {
  return isDone(task) ? 'done_task_count' : 'open_task_count'
}

/** 子任务出现或消失时，调整父任务上的「已完成 x / 共 y」 */
function adjustSubtaskCount(queryClient: QueryClient, subtask: Task, delta: number) {
  if (!subtask.parent_id) return
  const done = isDone(subtask) ? delta : 0
  updateCachedTask(queryClient, subtask.parent_id, (parent) => ({
    ...parent,
    subtask_count: Math.max(0, parent.subtask_count + delta),
    done_subtask_count: Math.max(0, parent.done_subtask_count + done),
  }))
}

/**
 * 一次变化（before → after）：更新列表，调整侧边栏上的计数和父任务上的子任务计数，
 * 并按后端的规则（见 backend/app/tasks/service.py 开头）连带修改子任务或父任务。
 * cascade 为 false 时只改这一个任务本身。
 */
function applyChange(
  queryClient: QueryClient,
  before: Task | null,
  after: Task | null,
  { cascade = true } = {},
) {
  const task = before ?? after
  if (!task) return
  writeLists(queryClient, task.id, after)
  // 项目计数只算顶层任务，和项目列表一致
  if (before && !before.parent_id) {
    adjustTaskCount(queryClient, before.project_id, countField(before), -1)
  }
  if (after && !after.parent_id) {
    adjustTaskCount(queryClient, after.project_id, countField(after), 1)
  }
  if (before) adjustSubtaskCount(queryClient, before, -1)
  if (after) adjustSubtaskCount(queryClient, after, 1)
  if (!cascade) return

  if (before && !before.parent_id) cascadeToSubtasks(queryClient, before, after)
  // 子任务变回未完成（重新打开或恢复）时，已完成的父任务也重新打开（只打开父任务本身）
  if (after?.parent_id && !isDone(after) && (!before || isDone(before))) {
    const parent = findCachedTask(queryClient, after.parent_id)
    if (parent && isDone(parent)) {
      const reopened: Task = { ...parent, status: 'todo', completed_at: null }
      applyChange(queryClient, parent, reopened, { cascade: false })
    }
  }
}

/** 父任务被删除、完成、重新打开或移到别的项目时，缓存里的子任务跟着变 */
function cascadeToSubtasks(queryClient: QueryClient, parent: Task, after: Task | null) {
  let reopened = 0
  for (const child of cachedSubtasks(queryClient, parent.id)) {
    let next: Task | null = child
    if (!after) {
      next = null
    } else if (isDone(after) && !isDone(parent)) {
      if (!isDone(child)) next = { ...child, status: 'done', completed_at: after.completed_at }
    } else if (!isDone(after) && isDone(parent)) {
      // 只有和父任务一起完成的才重新打开
      if (isDone(child) && child.completed_at === parent.completed_at) {
        next = { ...child, status: 'todo', completed_at: null }
        reopened += 1
      }
    }
    if (after && next && next.project_id !== after.project_id) {
      next = { ...next, project_id: after.project_id }
    }
    if (next !== child) writeLists(queryClient, child.id, next)
  }
  if (after && reopened > 0) {
    updateCachedTask(queryClient, after.id, (t) => ({
      ...t,
      done_subtask_count: Math.max(0, t.done_subtask_count - reopened),
    }))
  }
}

/** 按 patch 算出修改后的任务，规则和后端 update_task 一致 */
function patched(task: Task, patch: TaskUpdate): Task {
  const status = patch.status ?? task.status
  const moved = !!patch.project_id && patch.project_id !== task.project_id
  // 截止日期和时间一起改：只要带了 due_date，没带的 due_time 就是全天
  const dueChanged = 'due_date' in patch
  const completing = status === 'done' && !isDone(task)
  return {
    ...task,
    // 子任务单独移到别的项目后变成那里的顶层任务
    parent_id: moved ? null : task.parent_id,
    // 完成父任务时，子任务全部完成
    done_subtask_count: completing ? task.subtask_count : task.done_subtask_count,
    title: patch.title ?? task.title,
    description: patch.description ?? task.description,
    project_id: patch.project_id ?? task.project_id,
    priority: patch.priority ?? task.priority,
    label_ids: patch.label_ids ?? task.label_ids,
    due_date: dueChanged ? (patch.due_date ?? null) : task.due_date,
    due_time: dueChanged ? (patch.due_time ?? null) : task.due_time,
    status,
    completed_at:
      status === task.status
        ? task.completed_at
        : status === 'done'
          ? new Date().toISOString()
          : null,
    // 移到别的项目时服务端会放到末尾
    sort_key: moved ? PENDING_SORT_KEY : task.sort_key,
  }
}

type Snapshot = [QueryKey, unknown][]

async function snapshot(queryClient: QueryClient): Promise<Snapshot> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: TASKS_KEY }),
    queryClient.cancelQueries({ queryKey: PROJECTS_KEY }),
  ])
  return [
    ...queryClient.getQueriesData({ queryKey: TASKS_KEY }),
    ...queryClient.getQueriesData({ queryKey: PROJECTS_KEY }),
  ]
}

/** 失败时回滚到操作前的缓存，并提示用户。
 *
 * 写在 useMutation 的选项里而不是 mutate() 的回调里：任务完成或删除后会立刻从列表中消失，
 * 组件随之卸载，而 mutate() 的回调在组件卸载后不会执行。
 */
function rollback(queryClient: QueryClient, err: unknown, snap: Snapshot | undefined) {
  snap?.forEach(([key, data]) => queryClient.setQueryData(key, data))
  // 会话失效由 QueryClient 统一处理（跳到登录页），不再重复提示
  if (!(err instanceof ApiError && err.code === 'not_authenticated')) {
    toast.error(errorMessage(i18n.t, err))
  }
}

/** 只剩当前这一个写操作时才用服务端的结果覆盖缓存，否则会冲掉别的操作的乐观更新 */
const isLastMutation = (queryClient: QueryClient) =>
  queryClient.isMutating({ mutationKey: TASK_MUTATION }) === 1

/** 最后一个写操作结束时再和服务端同步，避免中途的重新拉取覆盖掉其他乐观更新 */
function syncWhenIdle(queryClient: QueryClient) {
  if (isLastMutation(queryClient)) {
    void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
  }
}

// ---------- 写操作 ----------

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: (body: NewTask) => unwrap(api.POST('/api/v1/tasks', { body })),
    onMutate: async (body) => {
      const snap = await snapshot(queryClient)
      const now = new Date().toISOString()
      const temp: Task = {
        id: `temp-${crypto.randomUUID()}`,
        project_id: body.project_id,
        parent_id: body.parent_id ?? null,
        title: body.title.trim(),
        description: body.description ?? '',
        status: body.status ?? 'todo',
        priority: body.priority ?? 4,
        due_date: body.due_date ?? null,
        due_time: body.due_time ?? null,
        label_ids: body.label_ids ?? [],
        subtask_count: 0,
        done_subtask_count: 0,
        sort_key: PENDING_SORT_KEY,
        completed_at: null,
        created_at: now,
        updated_at: now,
      }
      applyChange(queryClient, null, temp)
      return { snap, temp }
    },
    // 用服务端返回的任务替换临时任务（计数不变）。临时任务不能被编辑，不会和别的操作冲突
    onSuccess: (task, _vars, context) => writeLists(queryClient, context.temp.id, task),
    onError: (err, _vars, context) => rollback(queryClient, err, context?.snap),
    onSettled: () => syncWhenIdle(queryClient),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: ({ task, patch }: { task: Task; patch: TaskUpdate }) =>
      unwrap(
        api.PATCH('/api/v1/tasks/{task_id}', {
          params: { path: { task_id: task.id } },
          body: patch,
        }),
      ),
    onMutate: async ({ task, patch }) => {
      const snap = await snapshot(queryClient)
      applyChange(queryClient, task, patched(task, patch))
      return { snap }
    },
    onSuccess: (task) => {
      if (isLastMutation(queryClient)) writeLists(queryClient, task.id, task)
    },
    onError: (err, _vars, context) => rollback(queryClient, err, context?.snap),
    onSettled: () => syncWhenIdle(queryClient),
  })
}

/**
 * 拖拽后任务的新 key，用来乐观地把任务放到新位置。规则和后端 move_task 一样：
 * 已经在 prev 和 next 之间就不改（例如看板上拖到空的一列），否则在两者之间生成一个。
 * 算法也和后端的一样（fractional-indexing），但最终以服务端返回的 key 为准。
 */
function placedKey(task: Task, prev: Task | null, next: Task | undefined): string | undefined {
  const key = task.sort_key
  if ((!prev || prev.sort_key < key) && (!next || key < next.sort_key)) return key
  try {
    return generateKeyBetween(prev?.sort_key ?? null, next?.sort_key ?? null)
  } catch {
    // 缓存里的顺序和 key 对不上（不应该发生）：不做乐观更新，等服务端结果
    return undefined
  }
}

interface MoveVars {
  task: Task
  after: Task | null
  /** 看板上的目标列 */
  status?: TaskStatus
  /** 乐观更新用的 key；算不出来时为空，等服务端结果 */
  sortKey?: string
}

/**
 * 拖拽排序。order 是放下后的新顺序（同一个列表里的任务；看板上是目标列里的任务），
 * status 是看板上的目标列（没换列也要传，后端据此判断位置；不能是 done：拖到「已完成」
 * 等于勾选完成，见 useToggleDone）。
 * 还没保存好的新任务（临时 id）不能作为位置参照，跳过它们：它们总是排在末尾。
 */
export function useMoveTask() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: ({ task, after, status }: MoveVars) =>
      unwrap(
        api.POST('/api/v1/tasks/{task_id}/move', {
          params: { path: { task_id: task.id } },
          body: { after_id: after?.id ?? null, status },
        }),
      ),
    onMutate: async ({ task, status, sortKey }) => {
      const snap = await snapshot(queryClient)
      const moved = sortKey ? { ...task, sort_key: sortKey } : task
      if (status && status !== task.status) {
        // 状态变了：和勾选一样更新计数，从「已完成」拖回来时连带重新打开子任务
        applyChange(queryClient, task, { ...patched(task, { status }), sort_key: moved.sort_key })
      } else if (sortKey) {
        writeLists(queryClient, task.id, moved)
      }
      return { snap }
    },
    onSuccess: (task) => {
      if (isLastMutation(queryClient)) writeLists(queryClient, task.id, task)
    },
    onError: (err, _vars, context) => rollback(queryClient, err, context?.snap),
    onSettled: () => syncWhenIdle(queryClient),
  })
  return (task: Task, order: Task[], status?: Exclude<TaskStatus, 'done'>) => {
    const saved = order.filter((t) => !isPendingTask(t))
    const index = saved.findIndex((t) => t.id === task.id)
    if (index < 0) return
    const after = saved[index - 1] ?? null
    mutation.mutate({ task, after, status, sortKey: placedKey(task, after, saved[index + 1]) })
  }
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: (task: Task) =>
      unwrap(api.DELETE('/api/v1/tasks/{task_id}', { params: { path: { task_id: task.id } } })),
    onMutate: async (task) => {
      const snap = await snapshot(queryClient)
      applyChange(queryClient, task, null)
      return { snap }
    },
    onError: (err, _vars, context) => rollback(queryClient, err, context?.snap),
    onSettled: () => syncWhenIdle(queryClient),
  })
}

/** 撤销删除 */
export function useRestoreTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: (task: Task) =>
      unwrap(
        api.POST('/api/v1/tasks/{task_id}/restore', { params: { path: { task_id: task.id } } }),
      ),
    onMutate: async (task) => {
      const snap = await snapshot(queryClient)
      applyChange(queryClient, null, task)
      return { snap }
    },
    onError: (err, _vars, context) => rollback(queryClient, err, context?.snap),
    onSettled: () => syncWhenIdle(queryClient),
  })
}
