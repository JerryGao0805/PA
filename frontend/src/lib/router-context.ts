import type { QueryClient } from '@tanstack/react-query'

/** 注入到所有路由的上下文（loader / beforeLoad 中可用） */
export interface RouterContext {
  queryClient: QueryClient
}
