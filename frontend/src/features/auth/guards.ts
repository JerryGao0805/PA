import { redirect, type ParsedLocation } from '@tanstack/react-router'

import type { RouterContext } from '@/lib/router-context'

import { meQuery } from './api'

interface GuardArgs {
  context: RouterContext
  location: ParsedLocation
}

/** 需要登录的页面：未登录时跳到登录页，并记住原来要去的地址 */
export async function requireAuth({ context, location }: GuardArgs) {
  const user = await context.queryClient.ensureQueryData(meQuery)
  if (!user) {
    throw redirect({ to: '/login', search: { redirect: location.href }, replace: true })
  }
}

/** 只给未登录用户看的页面（登录、注册、找回密码）：已登录就直接进应用 */
export async function requireGuest({ context }: GuardArgs) {
  const user = await context.queryClient.ensureQueryData(meQuery)
  if (user) throw redirect({ to: '/', replace: true })
}
