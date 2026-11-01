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
