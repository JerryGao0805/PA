import { createFileRoute } from '@tanstack/react-router'

import { AppLayout } from '@/features/app-shell/AppLayout'
import { requireAuth } from '@/features/auth/guards'

export const Route = createFileRoute('/_app')({
  beforeLoad: requireAuth,
  component: AppLayout,
})
