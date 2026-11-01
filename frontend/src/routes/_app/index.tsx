import { createFileRoute, redirect } from '@tanstack/react-router'

// 首页先进收件箱；M2.2 有了「今天」视图后改为默认进「今天」
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/inbox', replace: true })
  },
})
