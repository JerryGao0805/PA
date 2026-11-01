import { createFileRoute } from '@tanstack/react-router'

import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage'

// 不限制登录状态：用户可能在另一台设备上打开验证链接
export const Route = createFileRoute('/_auth/verify-email')({
  component: VerifyEmailPage,
})
