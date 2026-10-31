import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from './api-error'

function isSessionExpired(err: unknown): boolean {
  // 只处理「会话失效」：登录接口返回的 invalid_credentials 也是 401，但不应触发跳转
  return err instanceof ApiError && err.code === 'not_authenticated'
}

/** onUnauthorized：任何请求发现会话已失效（例如在别的设备上改了密码）时调用 */
export function createQueryClient(onUnauthorized: () => void = () => {}) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => {
        if (isSessionExpired(err)) onUnauthorized()
      },
    }),
    mutationCache: new MutationCache({
      onError: (err) => {
        if (isSessionExpired(err)) onUnauthorized()
      },
    }),
    defaultOptions: {
      queries: {
        // 4xx 重试没有意义；网络错误和 5xx 最多重试 2 次
        retry: (count, err) =>
          count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
    },
  })
}
