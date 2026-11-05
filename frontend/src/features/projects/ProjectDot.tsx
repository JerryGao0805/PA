import { Inbox } from 'lucide-react'

import { COLOR_BG_CLASS, type Color } from '@/lib/colors'
import { cn } from '@/lib/utils'

export function ProjectDot({ color, className }: { color: Color; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        COLOR_BG_CLASS[color],
        className,
      )}
    />
  )
}

/**
 * 项目的图标：收件箱是收件箱图标，其他项目是颜色圆点。圆点放在和图标一样大的方框里，两种对得齐；
 * className 调整方框（图标）的大小
 */
export function ProjectIcon({
  project,
  className,
}: {
  project: { is_inbox?: boolean; color: Color }
  className?: string
}) {
  if (project.is_inbox) {
    return <Inbox aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
  }
  return (
    <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center', className)}>
      <ProjectDot color={project.color} />
    </span>
  )
}
