import type { TFunction } from 'i18next'

import { daysBetween, formatMonthDay, formatTime, formatWeekday, relativeDay } from '@/lib/dates'

import type { Task } from './api'

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

/** 截止日期在界面上的写法：今天 / 明天 / 周三 / 11月10日，有时间时带上时间 */
export function describeDue(
  due: Pick<Task, 'due_date' | 'due_time'>,
  today: string,
  t: TFunction,
  locale: string,
): { text: string; tone: DueTone } | null {
  if (!due.due_date) return null
  const diff = daysBetween(today, due.due_date)
  const relative = relativeDay(due.due_date, today)
  const day = relative
    ? t(`dates.${relative}`)
    : diff > 0 && diff < 7
      ? formatWeekday(due.due_date, locale)
      : formatMonthDay(due.due_date, today, locale)
  const text = due.due_time ? `${day} ${formatTime(due.due_time)}` : day
  const tone: DueTone = diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff < 7 ? 'soon' : 'later'
  return { text, tone }
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-green-700 dark:text-green-400',
  soon: 'text-violet-600 dark:text-violet-400',
  later: 'text-muted-foreground',
}

/** 优先级：复选框边框的颜色。P4（默认）用中性色 */
export const PRIORITY_CHECKBOX_CLASS: Record<number, string> = {
  1: 'border-red-600 bg-red-500/10 dark:border-red-400',
  2: 'border-orange-600 bg-orange-500/10 dark:border-orange-400',
  3: 'border-blue-600 bg-blue-500/10 dark:border-blue-400',
  4: 'border-muted-foreground/80',
}

export const PRIORITY_TEXT_CLASS: Record<number, string> = {
  1: 'text-red-600 dark:text-red-400',
  2: 'text-orange-600 dark:text-orange-400',
  3: 'text-blue-600 dark:text-blue-400',
  4: 'text-muted-foreground',
}

export const PRIORITIES = [1, 2, 3, 4] as const
