import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Project = components['schemas']['ProjectOut']
export type ProjectLayout = Project['layout']
type ProjectCreate = components['schemas']['ProjectCreate']
type ProjectUpdate = components['schemas']['ProjectUpdate']

export const PROJECTS_KEY = ['projects'] as const
// 和 features/tasks/api.ts 里的一致；写在这里避免两个模块互相导入
const TASKS_KEY = ['tasks'] as const

/** 全部项目（收件箱在最前，包括已归档的） */
export const projectsQuery = queryOptions({
  queryKey: PROJECTS_KEY,
  queryFn: () => unwrap(api.GET('/api/v1/projects')),
})

export function findInbox(projects: Project[]): Project | undefined {
  return projects.find((p) => p.is_inbox)
}

/** 乐观地调整侧边栏上的任务计数；请求结束后会重新拉取，以服务端为准 */
export function adjustTaskCount(
  queryClient: QueryClient,
  projectId: string,
  field: 'open_task_count' | 'done_task_count',
  delta: number,
) {
  queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
    projects?.map((p) =>
      p.id === projectId ? { ...p, [field]: Math.max(0, p[field] + delta) } : p,
    ),
  )
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectCreate) => unwrap(api.POST('/api/v1/projects', { body })),
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
        projects ? [...projects, project] : projects,
      )
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProjectUpdate }) =>
      unwrap(
        api.PATCH('/api/v1/projects/{project_id}', {
          params: { path: { project_id: id } },
          body: patch,
        }),
      ),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: PROJECTS_KEY })
      const previous = queryClient.getQueryData<Project[]>(PROJECTS_KEY)
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
        projects?.map((p) =>
          p.id === id
            ? {
                ...p,
                name: patch.name ?? p.name,
                color: patch.color ?? p.color,
                archived: patch.archived ?? p.archived,
                layout: patch.layout ?? p.layout,
              }
            : p,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(PROJECTS_KEY, context?.previous)
    },
    onSuccess: (project, { patch }) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
        projects?.map((p) => (p.id === project.id ? project : p)),
      )
      // 「今天」等跨项目的列表不含已归档项目里的任务
      if (patch.archived !== undefined) void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}

/** 把 id 移到 afterId 后面；afterId 为 null 表示放到收件箱后面的第一个 */
function placeAfter(projects: Project[], id: string, afterId: string | null): Project[] {
  const moving = projects.find((p) => p.id === id)
  const rest = projects.filter((p) => p.id !== id)
  const index =
    afterId === null
      ? rest.findIndex((p) => !p.is_inbox)
      : rest.findIndex((p) => p.id === afterId) + 1
  if (!moving || (afterId !== null && index === 0)) return projects
  return [
    ...rest.slice(0, index < 0 ? rest.length : index),
    moving,
    ...rest.slice(index < 0 ? rest.length : index),
  ]
}

/** 拖拽排序（侧边栏）：after 为 null 表示放到最前（收件箱始终在最前） */
export function useMoveProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ project, after }: { project: Project; after: Project | null }) =>
      unwrap(
        api.POST('/api/v1/projects/{project_id}/move', {
          params: { path: { project_id: project.id } },
          body: { after_id: after?.id ?? null },
        }),
      ),
    onMutate: async ({ project, after }) => {
      await queryClient.cancelQueries({ queryKey: PROJECTS_KEY })
      const previous = queryClient.getQueryData<Project[]>(PROJECTS_KEY)
      queryClient.setQueryData<Project[]>(
        PROJECTS_KEY,
        (projects) => projects && placeAfter(projects, project.id, after?.id ?? null),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(PROJECTS_KEY, context?.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/api/v1/projects/{project_id}', { params: { path: { project_id: id } } })),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
        projects?.filter((p) => p.id !== id),
      )
      // 项目里的任务也一并删除了：所有任务列表都要重新拉取
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}
