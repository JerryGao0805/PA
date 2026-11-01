import { hashKey, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { ApiError, unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type User = components['schemas']['UserOut']
type RegisterInput = components['schemas']['RegisterIn']
type LoginInput = components['schemas']['LoginIn']

const ME_KEY = ['auth', 'me'] as const

/** 当前登录用户；未登录时为 null（不是错误） */
export const meQuery = queryOptions({
  queryKey: ME_KEY,
  queryFn: async (): Promise<User | null> => {
    try {
      return await unwrap(api.GET('/api/v1/auth/me'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },
  staleTime: Infinity,
  retry: false,
})

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: LoginInput) => unwrap(api.POST('/api/v1/auth/login', { body })),
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: RegisterInput) => unwrap(api.POST('/api/v1/auth/register', { body })),
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  })
}

/**
 * 退出登录。不管请求成败都清掉本地数据：退出操作对用户来说应该总是成功的。
 *
 * leave：离开需要登录的页面（跳到登录页）。顺序很重要：先把当前用户置空并离开，再清掉其余缓存。
 * 反过来的话，页面卸载前还会重新渲染一次的组件（例如侧边栏）发现数据没了，会重新请求并拿到 401。
 */
export function useLogout(leave: () => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/logout')),
    onSettled: async () => {
      queryClient.setQueryData(ME_KEY, null)
      await leave()
      const me = hashKey(ME_KEY)
      queryClient.removeQueries({ predicate: (query) => query.queryHash !== me })
    },
  })
}

export function useVerifyEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      unwrap(api.POST('/api/v1/auth/verify-email', { body: { token } })),
    onSuccess: (user) => {
      // 只有当前浏览器登录的就是这个用户时才更新（用户可能在别的设备上打开了链接）
      const me = queryClient.getQueryData<User | null>(ME_KEY)
      if (me?.id === user.id) queryClient.setQueryData(ME_KEY, user)
    },
  })
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/auth/resend-verification')),
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) =>
      unwrap(api.POST('/api/v1/auth/forgot-password', { body: { email } })),
  })
}

export function useResetPassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      unwrap(api.POST('/api/v1/auth/reset-password', { body })),
    // 服务端已吊销所有会话
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  })
}
