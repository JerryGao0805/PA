import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'

interface FormFieldProps {
  id: string
  label: string
  hint?: string
  error?: string
  /** 放在标签右侧的内容，例如「忘记密码？」链接 */
  aside?: ReactNode
  children: ReactNode
}

/** 标签 + 输入框 + 错误提示。错误文案通过 aria-describedby 关联给读屏软件 */
export function FormField({ id, label, hint, error, aside, children }: FormFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
        </Label>
        {aside}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
