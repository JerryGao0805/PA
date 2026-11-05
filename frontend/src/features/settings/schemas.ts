import { z } from 'zod'

import { newPassword } from '@/features/auth/schemas'

// 错误信息写成 i18n key，渲染时再翻译
export const profileSchema = z.object({
  display_name: z.string().trim().max(100, { error: 'validation.displayNameMax' }),
  timezone: z.string(),
})

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, { error: 'validation.required' }),
  new_password: newPassword,
})

export const deleteAccountSchema = z.object({
  password: z.string().min(1, { error: 'validation.required' }),
})

export type ProfileValues = z.infer<typeof profileSchema>
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>
export type DeleteAccountValues = z.infer<typeof deleteAccountSchema>
