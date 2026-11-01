import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import { toast } from 'sonner'

import { adjustTaskCount, PROJECTS_KEY, type Project } from '@/features/projects/api'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { ApiError, errorMessage, unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Task = components['schemas']['TaskOut']
export type TaskStatus = Task['status']
export type TaskUpdate = components['schemas']['TaskUpdate']
/** 前端总是明确指定项目（收件箱也一样），这样乐观更新时知道该调整哪个计数 */
export type NewTask = components['schemas']['TaskCreate'] & { project_id: string }

/**
 * 任务列表的筛选条件，和后端 GET /tasks 的参数一一对应。
 * 每种组合是一个独立的缓存；写操作时按条件判断任务该不该出现在某个列表里。
 */
export interface TaskFilter {
  project_id?: string
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

/** 在已缓存的列表里找这个任务（打开详情时先用它显示，不用等请求） */
export function findCachedTask(queryClient: QueryClient, id: string): Task | undefined {
  for (const [, list] of queryClient.getQueriesData<Task[]>({ queryKey: LISTS_KEY })) {
    const task = list?.find((t) => t.id === id)
    if (task) return task
  }
  return undefined
}

/** 还没收到服务端响应的新任务用临时 id，界面上会禁用对它的操作 */
export const isPendingTask = (task: Task) => task.id.startsWith('temp-')
// '~' 的字节值大于所有 base62 字符，临时任务因此排在末尾
const PENDING_SORT_KEY = '~'

// ---------- 列表的成员和顺序：和后端 list_tasks 的规则保持一致 ----------

function belongs(task: Task, filter: TaskFilter, archived: Set<string>): boolean {
  if (isDone(task) !== !!filter.done) return false
  if (filter.project_id) {
    if (task.project_id !== filter.project_id) return false
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
  // 项目里：手动顺序
  if (filter.project_id) return (a, b) => byBytes(a.sort_key, b.sort_key)
  // 跨项目：截止日期、时间（没有的排后面）、优先级、创建时间
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

function countField(task: Task) {
  return isDone(task) ? 'done_task_count' : 'open_task_count'
}

/** 一次变化（before → after）：更新列表，并调整侧边栏上的计数 */
function applyChange(queryClient: QueryClient, before: Task | null, after: Task | null) {
  const id = (before ?? after)?.id
  if (!id) return
  writeLists(queryClient, id, after)
  if (before) adjustTaskCount(queryClient, before.project_id, countField(before), -1)
  if (after) adjustTaskCount(queryClient, after.project_id, countField(after), 1)
}

/** 按 patch 算出修改后的任务，规则和后端 update_task 一致 */
function patched(task: Task, patch: TaskUpdate): Task {
  const status = patch.status ?? task.status
  const moved = !!patch.project_id && patch.project_id !== task.project_id
  // 截止日期和时间一起改：只要带了 due_date，没带的 due_time 就是全天
  const dueChanged = 'due_date' in patch
  return {
    ...task,
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
        title: body.title.trim(),
        description: body.description ?? '',
        status: 'todo',
        priority: body.priority ?? 4,
        due_date: body.due_date ?? null,
        due_time: body.due_time ?? null,
        label_ids: body.label_ids ?? [],
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
