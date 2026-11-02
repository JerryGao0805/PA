import { createFileRoute } from '@tanstack/react-router'

import { projectsQuery } from '@/features/projects/api'
import { tasksQuery } from '@/features/tasks/api'
import { TodayPage } from '@/features/tasks/pages'
import { todayFilter, todayFor } from '@/features/tasks/use-today'

export const Route = createFileRoute('/_app/today')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(projectsQuery),
      queryClient.ensureQueryData(tasksQuery(todayFilter(todayFor(queryClient)))),
    ]),
  component: TodayPage,
})
