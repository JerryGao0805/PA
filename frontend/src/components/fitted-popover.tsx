import type { ComponentProps } from 'react'

import { PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * 不超出屏幕的弹层：离屏幕边缘至少 8px，内容比可用空间高时在弹层里滚动。
 * 手机屏幕矮，日期选择这样高的弹层在触发按钮上下都放不下，不加限制会被截掉一截
 */
export function FittedPopoverContent({
  className,
  ...props
}: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      collisionPadding={8}
      className={cn('max-h-(--radix-popover-content-available-height) overflow-y-auto', className)}
      {...props}
    />
  )
}
