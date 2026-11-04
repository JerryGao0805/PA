import { Circle, CircleCheck, CircleDot, type LucideIcon } from 'lucide-react'

import type { TaskStatus } from './api'

/** 看板上从左到右的顺序 */
export const STATUSES = ['todo', 'in_progress', 'done'] as const satisfies readonly TaskStatus[]

export const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  todo: Circle,
  in_progress: CircleDot,
  done: CircleCheck,
}

export const STATUS_TEXT_CLASS: Record<TaskStatus, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-amber-600 dark:text-amber-400',
  done: 'text-green-700 dark:text-green-400',
}
