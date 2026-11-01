import { createFileRoute } from '@tanstack/react-router'

import { projectsQuery } from '@/features/projects/api'
import { tasksQuery } from '@/features/tasks/api'
import { UpcomingPage } from '@/features/tasks/pages'
import { todayFor, upcomingFilter } from '@/features/tasks/use-today'

export const Route = createFileRoute('/_app/upcoming')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(projectsQuery),
      queryClient.ensureQueryData(tasksQuery(upcomingFilter(todayFor(queryClient)))),
    ]),
  component: UpcomingPage,
})
