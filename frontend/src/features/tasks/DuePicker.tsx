import { CalendarDays, CalendarOff, CalendarPlus, Sun, Sunrise, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { zhCN } from 'react-day-picker/locale'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  addDays,
  formatMonthDay,
  formatTime,
  formatWeekday,
  fromLocalDate,
  nextMonday,
  toLocalDate,
} from '@/lib/dates'
import { cn } from '@/lib/utils'

import type { Task } from './api'
import { describeDue, DUE_TONE_CLASS } from './due'
import { useToday } from './use-today'

export type Due = Pick<Task, 'due_date' | 'due_time'>

interface DuePickerProps {
  value: Due
  onChange: (due: Due) => void
}

/** 截止日期：常用选项 + 日历 + 可选的具体时间 */
export function DuePicker({ value, onChange }: DuePickerProps) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const [open, setOpen] = useState(false)
  const due = describeDue(value, today, t, i18n.language)

  // 换日期时保留原来的时间
  const pick = (date: string) => {
    onChange({ due_date: date, due_time: value.due_time })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            '-ml-2 justify-start font-normal',
            due ? DUE_TONE_CLASS[due.tone] : 'text-muted-foreground',
          )}
        >
          <CalendarDays />
          {due ? due.text : t('tasks.due.add')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="grid gap-0.5 border-b p-1">
          <QuickOption
            icon={<Sun className="text-green-600" />}
            label={t('tasks.due.today')}
            hint={formatWeekday(today, i18n.language)}
            onSelect={() => pick(today)}
          />
          <QuickOption
            icon={<Sunrise className="text-orange-600" />}
            label={t('tasks.due.tomorrow')}
            hint={formatWeekday(addDays(today, 1), i18n.language)}
            onSelect={() => pick(addDays(today, 1))}
          />
          <QuickOption
            icon={<CalendarPlus className="text-violet-600" />}
            label={t('tasks.due.nextWeek')}
            // 「下周一」本身就是星期几，提示里给出具体日期
            hint={formatMonthDay(nextMonday(today), today, i18n.language)}
            onSelect={() => pick(nextMonday(today))}
          />
          {value.due_date && (
            <QuickOption
              icon={<CalendarOff className="text-muted-foreground" />}
              label={t('tasks.due.none')}
              onSelect={() => {
                onChange({ due_date: null, due_time: null })
                setOpen(false)
              }}
            />
          )}
        </div>
        <Calendar
          mode="single"
          locale={zhCN}
          today={toLocalDate(today)}
          selected={value.due_date ? toLocalDate(value.due_date) : undefined}
          defaultMonth={toLocalDate(value.due_date ?? today)}
          onSelect={(date) => date && pick(fromLocalDate(date))}
        />
        {value.due_date && (
          <TimeField
            // 时间在别处被改了（例如撤销）时重新取初始值
            key={value.due_time ?? ''}
            date={value.due_date}
            time={value.due_time}
            onChange={onChange}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function QuickOption({
  icon,
  label,
  hint,
  onSelect,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted [&_svg]:size-4"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  )
}

/** 具体时间：输入完离开输入框时才保存，避免每改一位数字就发一次请求 */
function TimeField({
  date,
  time,
  onChange,
}: {
  date: string
  time: string | null
  onChange: (due: Due) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(time ? formatTime(time) : '')
  const commit = (next: string) => {
    const current = time ? formatTime(time) : ''
    if (next !== current) onChange({ due_date: date, due_time: next || null })
  }

  return (
    <div className="flex items-center gap-2 border-t p-2">
      <label htmlFor="due-time" className="text-sm text-muted-foreground">
        {t('tasks.due.time')}
      </label>
      <Input
        id="due-time"
        type="time"
        value={draft}
        className="h-8 w-32"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
        }}
      />
      {time && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('tasks.due.clearTime')}
          title={t('tasks.due.clearTime')}
          onClick={() => onChange({ due_date: date, due_time: null })}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
