import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

import { toast } from 'sonner'

import { adjustTaskCount, PROJECTS_KEY } from '@/features/projects/api'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { ApiError, errorMessage, unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Task = components['schemas']['TaskOut']
export type TaskStatus = Task['status']
type TaskUpdate = components['schemas']['TaskUpdate']

const TASKS_KEY = ['tasks'] as const
const tasksKey = (projectId: string, done: boolean) =>
  [...TASKS_KEY, projectId, done ? 'done' : 'open'] as const
// 所有任务相关的写操作共用一个 mutationKey，用来判断是否还有别的写操作在进行
const TASK_MUTATION = ['tasks', 'mutation'] as const

const isDone = (task: Pick<Task, 'status'>) => task.status === 'done'

/** 项目里的任务：done=false 为未完成（按 sort_key 排序），done=true 为最近完成的 */
export const tasksQuery = (projectId: string, done: boolean) =>
  queryOptions({
    queryKey: tasksKey(projectId, done),
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks', { params: { query: { project_id: projectId, done } } })),
  })

/** 还没收到服务端响应的新任务用临时 id，界面上会禁用对它的操作 */
export const isPendingTask = (task: Task) => task.id.startsWith('temp-')
// '~' 的字节值大于所有 base62 字符，临时任务因此排在末尾
const PENDING_SORT_KEY = '~'

// ---------- 乐观更新：直接修改缓存里的列表和计数 ----------

function insertSorted(list: Task[], task: Task, done: boolean): Task[] {
  const next = [...list, task]
  // 未完成的按 sort_key 字节序（和服务端 COLLATE "C" 一致）；已完成的新的在前
  return done
    ? next.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    : next.sort((a, b) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : 0))
}

/** 把一次变化（before → after）应用到缓存：从旧列表移除、插入新列表，并调整计数 */
function applyChange(queryClient: QueryClient, before: Task | null, after: Task | null) {
  if (before) {
    queryClient.setQueryData<Task[]>(tasksKey(before.project_id, isDone(before)), (list) =>
      list?.filter((t) => t.id !== before.id),
    )
    const field = isDone(before) ? 'done_task_count' : 'open_task_count'
    adjustTaskCount(queryClient, before.project_id, field, -1)
  }
  if (after) {
    queryClient.setQueryData<Task[]>(tasksKey(after.project_id, isDone(after)), (list) =>
      list ? insertSorted(list, after, isDone(after)) : list,
    )
    const field = isDone(after) ? 'done_task_count' : 'open_task_count'
    adjustTaskCount(queryClient, after.project_id, field, 1)
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

/** 最后一个写操作结束时再和服务端同步，避免中途的重新拉取覆盖掉其他乐观更新 */
function syncWhenIdle(queryClient: QueryClient) {
  if (queryClient.isMutating({ mutationKey: TASK_MUTATION }) === 1) {
    void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
  }
}

// ---------- 写操作 ----------

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: TASK_MUTATION,
    mutationFn: (vars: { projectId: string; title: string }) =>
      unwrap(
        api.POST('/api/v1/tasks', { body: { title: vars.title, project_id: vars.projectId } }),
      ),
    onMutate: async ({ projectId, title }) => {
      const snap = await snapshot(queryClient)
      const now = new Date().toISOString()
      const temp: Task = {
        id: `temp-${crypto.randomUUID()}`,
        project_id: projectId,
        title: title.trim(),
        description: '',
        status: 'todo',
        sort_key: PENDING_SORT_KEY,
        completed_at: null,
        created_at: now,
        updated_at: now,
      }
      applyChange(queryClient, null, temp)
      return { snap, temp }
    },
    onSuccess: (task, _vars, context) => {
      // 用服务端返回的任务替换临时任务（计数不变）
      queryClient.setQueryData<Task[]>(tasksKey(task.project_id, false), (list) =>
        list
          ? insertSorted(
              list.filter((t) => t.id !== context.temp.id),
              task,
              false,
            )
          : list,
      )
    },
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
      const status = patch.status ?? task.status
      const statusChanged = status !== task.status
      const after: Task = {
        ...task,
        title: patch.title ?? task.title,
        description: patch.description ?? task.description,
        project_id: patch.project_id ?? task.project_id,
        status,
        completed_at: statusChanged
          ? status === 'done'
            ? new Date().toISOString()
            : null
          : task.completed_at,
        // 移到别的项目时服务端会放到末尾
        sort_key:
          patch.project_id && patch.project_id !== task.project_id
            ? PENDING_SORT_KEY
            : task.sort_key,
      }
      applyChange(queryClient, task, after)
      return { snap }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(tasksKey(task.project_id, isDone(task)), (list) =>
        list
          ? insertSorted(
              list.filter((t) => t.id !== task.id),
              task,
              isDone(task),
            )
          : list,
      )
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
