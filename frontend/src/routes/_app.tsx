import { createFileRoute } from '@tanstack/react-router'

import { AppLayout } from '@/features/app-shell/AppLayout'
import { requireAuth } from '@/features/auth/guards'
import { labelsQuery } from '@/features/labels/api'
import { projectsQuery } from '@/features/projects/api'

interface AppSearch {
  /** 打开详情面板的任务 id；所有页面都可以带，例如 /today?task=… */
  task?: string
}

export const Route = createFileRoute('/_app')({
  validateSearch: (search: Record<string, unknown>): AppSearch => ({
    task: typeof search.task === 'string' && search.task ? search.task : undefined,
  }),
  beforeLoad: requireAuth,
  // 侧边栏和所有页面都要用到
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(projectsQuery),
      queryClient.ensureQueryData(labelsQuery),
    ]),
  component: AppLayout,
})
