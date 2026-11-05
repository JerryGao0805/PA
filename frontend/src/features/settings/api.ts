import { useMutation, useQueryClient } from '@tanstack/react-query'

import { meQuery, signOutLocally } from '@/features/auth/api'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

type AccountUpdate = components['schemas']['AccountUpdate']
type ChangePasswordInput = components['schemas']['ChangePasswordIn']

/**
 * 改名字、时区。用返回的用户替换缓存里的：侧边栏上的名字跟着变，
 * 「今天」等列表的日期按新时区重新算（缓存 key 里带着日期，会重新请求）
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AccountUpdate) => unwrap(api.PATCH('/api/v1/account', { body })),
    onSuccess: (user) => queryClient.setQueryData(meQuery.queryKey, user),
  })
}

/** 修改密码：当前设备保持登录，其他设备全部退出 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordInput) =>
      unwrap(api.POST('/api/v1/auth/change-password', { body })),
  })
}

/** 永久删除账户。成功后和退出登录一样清掉本地数据，leave 跳到登录页 */
export function useDeleteAccount(leave: () => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (password: string) =>
      unwrap(api.POST('/api/v1/account/delete', { body: { password } })),
    onSuccess: () => signOutLocally(queryClient, leave),
  })
}
