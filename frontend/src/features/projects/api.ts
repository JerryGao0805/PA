import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Project = components['schemas']['ProjectOut']
export type ProjectColor = Project['color']
type ProjectCreate = components['schemas']['ProjectCreate']
type ProjectUpdate = components['schemas']['ProjectUpdate']

export const PROJECTS_KEY = ['projects'] as const

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
              }
            : p,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(PROJECTS_KEY, context?.previous)
    },
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (projects) =>
        projects?.map((p) => (p.id === project.id ? project : p)),
      )
    },
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
      queryClient.removeQueries({ queryKey: ['tasks', id] })
    },
  })
}
