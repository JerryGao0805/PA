import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, type RouterHistory } from '@tanstack/react-router'

import { meQuery } from '@/features/auth/api'
import { createQueryClient } from '@/lib/query-client'

import { createAppRouter, type AppRouter } from './router'

/** 创建一套完整的应用实例（QueryClient + Router）。测试里传入 memory history 复用同一套配置 */
export function createApp(history?: RouterHistory) {
  // router 和 queryClient 互相引用：会话失效时既要清掉用户数据，又要跳转到登录页
  let router: AppRouter | undefined
  const queryClient = createQueryClient(() => {
    queryClient.setQueryData(meQuery.queryKey, null)
    if (router && !router.state.location.pathname.startsWith('/login')) {
      void router.navigate({
        to: '/login',
        search: { redirect: router.state.location.href },
        replace: true,
      })
    }
  })
  router = createAppRouter(queryClient, history)

  function App() {
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router!} />
      </QueryClientProvider>
    )
  }
  return { App, router, queryClient }
}
