import { useSuspenseQuery, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { meQuery } from '@/features/auth/api'
import { addDays, todayIn } from '@/lib/dates'

import type { TaskFilter } from './api'

// 所有组件共用一个每分钟一次的定时器；日期没变时 React 不会重新渲染
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  timer ??= setInterval(() => listeners.forEach((l) => l()), 60_000)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/** 用户时区里的今天（YYYY-MM-DD）。页面一直开着时，过了午夜会自动变成新的一天 */
export function useToday(): string {
  const { data: user } = useSuspenseQuery(meQuery)
  const timeZone = user?.timezone ?? 'UTC'
  return useSyncExternalStore(subscribe, () => todayIn(timeZone))
}

/** 「即将到来」显示今天起 7 天 */
export const UPCOMING_DAYS = 7

/** 「今天」的查询条件：今天到期和已经逾期的 */
export const todayFilter = (today: string): TaskFilter => ({ due_to: today })
/** 「即将到来」：今天起 7 天 */
export const upcomingFilter = (today: string): TaskFilter => ({
  due_from: today,
  due_to: addDays(today, UPCOMING_DAYS - 1),
})

/** 路由 loader 里用：组件外拿不到 hook，直接从缓存里的当前用户算 */
export function todayFor(queryClient: QueryClient): string {
  const user = queryClient.getQueryData(meQuery.queryKey)
  return todayIn(user?.timezone ?? 'UTC')
}
