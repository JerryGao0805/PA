import { createFileRoute } from '@tanstack/react-router'

import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { requireGuest } from '@/features/auth/guards'

export const Route = createFileRoute('/_auth/forgot-password')({
  beforeLoad: requireGuest,
  component: ForgotPasswordPage,
})
