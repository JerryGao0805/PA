import { createFileRoute } from '@tanstack/react-router'

import { projectsQuery } from '@/features/projects/api'
import { ensureProjectTasks } from '@/features/tasks/api'
import { ProjectPage } from '@/features/tasks/pages'

export const Route = createFileRoute('/_app/projects/$projectId')({
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    const project = (await queryClient.ensureQueryData(projectsQuery)).find(
      (p) => p.id === projectId,
    )
    // 项目不存在时不请求任务列表，由页面显示「项目不存在」
    if (project) await ensureProjectTasks(queryClient, project)
  },
  component: ProjectPage,
})
