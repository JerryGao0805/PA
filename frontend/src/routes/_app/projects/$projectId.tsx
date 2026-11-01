import { createFileRoute } from '@tanstack/react-router'

import { projectsQuery } from '@/features/projects/api'
import { tasksQuery } from '@/features/tasks/api'
import { ProjectPage } from '@/features/tasks/pages'

export const Route = createFileRoute('/_app/projects/$projectId')({
  loader: async ({ context: { queryClient }, params: { projectId } }) => {
    const projects = await queryClient.ensureQueryData(projectsQuery)
    // 项目不存在时不请求任务列表，由页面显示「项目不存在」
    if (projects.some((p) => p.id === projectId)) {
      await queryClient.ensureQueryData(tasksQuery(projectId, false))
    }
  },
  component: ProjectPage,
})
