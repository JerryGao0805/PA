import type { ComponentProps } from 'react'

import { CommandInput as BaseCommandInput } from '@/components/ui/command'
import { cn } from '@/lib/utils'

/**
 * cmdk 的搜索框，手机上用 16px。shadcn 的 CommandInput 写死了 14px，iOS Safari 聚焦小于 16px 的
 * 输入框时会放大页面（shadcn 的 Input、Textarea 本来就是 text-base md:text-sm）
 */
export function CommandInput({ className, ...props }: ComponentProps<typeof BaseCommandInput>) {
  return <BaseCommandInput className={cn('text-base md:text-sm', className)} {...props} />
}
