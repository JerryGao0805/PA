import { createFileRoute } from '@tanstack/react-router'

import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'

// 不限制登录状态：用户可能在已登录的浏览器里打开重置链接
export const Route = createFileRoute('/_auth/reset-password')({
  component: ResetPasswordPage,
})
