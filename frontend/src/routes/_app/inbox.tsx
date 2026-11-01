import { createFileRoute } from '@tanstack/react-router'

import { findInbox, projectsQuery } from '@/features/projects/api'
import { tasksQuery } from '@/features/tasks/api'
import { InboxPage } from '@/features/tasks/pages'

export const Route = createFileRoute('/_app/inbox')({
  loader: async ({ context: { queryClient } }) => {
    const inbox = findInbox(await queryClient.ensureQueryData(projectsQuery))
    if (inbox) await queryClient.ensureQueryData(tasksQuery(inbox.id, false))
  },
  component: InboxPage,
})
