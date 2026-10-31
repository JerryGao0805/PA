import { createFileRoute } from '@tanstack/react-router'

import { RegisterPage } from '@/features/auth/RegisterPage'
import { requireGuest } from '@/features/auth/guards'

export const Route = createFileRoute('/_auth/register')({
  beforeLoad: requireGuest,
  component: RegisterPage,
})
