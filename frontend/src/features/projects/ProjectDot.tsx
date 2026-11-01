import { cn } from '@/lib/utils'

import type { ProjectColor } from './api'
import { PROJECT_COLOR_CLASS } from './colors'

export function ProjectDot({ color, className }: { color: ProjectColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        PROJECT_COLOR_CLASS[color],
        className,
      )}
    />
  )
}
