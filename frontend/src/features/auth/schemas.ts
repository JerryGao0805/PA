import { z } from 'zod'

// 错误信息写成 i18n key，渲染时再翻译
const email = z.email({ error: 'validation.emailInvalid' })
export const newPassword = z
  .string()
  .min(8, { error: 'validation.passwordMin' })
  .max(128, { error: 'validation.passwordMax' })
/** 输入已有的密码（登录、改密码、删除账户）：只要求填了，旧规则下设的密码也要能用 */
export const currentPassword = z.string().min(1, { error: 'validation.required' })
export const displayName = z.string().trim().max(100, { error: 'validation.displayNameMax' })

export const loginSchema = z.object({ email, password: currentPassword })

export const registerSchema = z.object({
  email,
  password: newPassword,
  display_name: displayName,
})

export const forgotSchema = z.object({ email })

export const resetSchema = z.object({ password: newPassword })

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type ForgotValues = z.infer<typeof forgotSchema>
export type ResetValues = z.infer<typeof resetSchema>
