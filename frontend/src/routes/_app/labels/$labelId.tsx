import { createFileRoute } from '@tanstack/react-router'

import { labelsQuery } from '@/features/labels/api'
import { tasksQuery } from '@/features/tasks/api'
import { LabelPage } from '@/features/tasks/pages'

export const Route = createFileRoute('/_app/labels/$labelId')({
  loader: async ({ context: { queryClient }, params: { labelId } }) => {
    const labels = await queryClient.ensureQueryData(labelsQuery)
    if (labels.some((l) => l.id === labelId)) {
      await queryClient.ensureQueryData(tasksQuery({ label_id: labelId }))
    }
  },
  component: LabelPage,
})
