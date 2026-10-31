import { z } from 'zod'

// 错误信息写成 i18n key，渲染时再翻译
const email = z.email({ error: 'validation.emailInvalid' })
const newPassword = z
  .string()
  .min(8, { error: 'validation.passwordMin' })
  .max(128, { error: 'validation.passwordMax' })

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: 'validation.required' }),
})

export const registerSchema = z.object({
  email,
  password: newPassword,
  display_name: z.string().trim().max(100, { error: 'validation.displayNameMax' }),
})

export const forgotSchema = z.object({ email })

export const resetSchema = z.object({ password: newPassword })

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
export type ForgotValues = z.infer<typeof forgotSchema>
export type ResetValues = z.infer<typeof resetSchema>
