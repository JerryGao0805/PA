import { createFileRoute } from '@tanstack/react-router'

import { LoginPage } from '@/features/auth/LoginPage'
import { requireGuest } from '@/features/auth/guards'

export const Route = createFileRoute('/_auth/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: requireGuest,
  component: LoginPage,
})
