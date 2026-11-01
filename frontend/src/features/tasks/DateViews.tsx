import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { findInbox, projectsQuery } from '@/features/projects/api'
import { addDays, formatMonthDay, formatWeekday, relativeDay } from '@/lib/dates'

import { tasksQuery } from './api'
import { AddTask } from './AddTask'
import { PageHeader, SectionHeading } from './PageHeader'
import { TaskList } from './TaskItem'
import { todayFilter, UPCOMING_DAYS, upcomingFilter, useToday } from './use-today'

function useInboxId(): string {
  const { data: projects } = useSuspenseQuery(projectsQuery)
  // 服务端保证每个账号都有收件箱
  return findInbox(projects)?.id ?? ''
}

/** 11月2日 · 明天 / 11月4日 · 周三 */
function useDayLabel() {
  const { t, i18n } = useTranslation()
  const today = useToday()
  return (date: string) => {
    const relative = relativeDay(date, today)
    const suffix = relative ? t(`dates.${relative}`) : formatWeekday(date, i18n.language)
    return `${formatMonthDay(date, today, i18n.language)} · ${suffix}`
  }
}

export function TodayView() {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const inboxId = useInboxId()
  const dayLabel = useDayLabel()
  const { data: tasks } = useSuspenseQuery(tasksQuery(todayFilter(today)))
  const overdue = tasks.filter((task) => task.due_date! < today)
  const dueToday = tasks.filter((task) => task.due_date === today)

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('nav.today')}
        subtitle={`${formatMonthDay(today, today, i18n.language)} ${formatWeekday(today, i18n.language)}`}
      />

      {overdue.length > 0 && (
        <section aria-labelledby="overdue-heading">
          <SectionHeading id="overdue-heading" count={overdue.length}>
            {t('tasks.overdue')}
          </SectionHeading>
          <TaskList tasks={overdue} showProject />
        </section>
      )}

      <section aria-labelledby={overdue.length > 0 ? 'today-heading' : undefined}>
        {overdue.length > 0 && (
          <SectionHeading id="today-heading" count={dueToday.length}>
            {dayLabel(today)}
          </SectionHeading>
        )}
        {dueToday.length > 0 && <TaskList tasks={dueToday} showProject />}
        {tasks.length === 0 && (
          <p className="pb-2 text-sm text-muted-foreground">{t('tasks.todayEmpty')}</p>
        )}
        <AddTask defaults={{ project_id: inboxId, due_date: today }} />
      </section>
    </div>
  )
}

export function UpcomingView() {
  const { t } = useTranslation()
  const today = useToday()
  const inboxId = useInboxId()
  const dayLabel = useDayLabel()
  const { data: tasks } = useSuspenseQuery(tasksQuery(upcomingFilter(today)))
  const days = Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i))

  return (
    <div className="grid gap-8">
      <PageHeader title={t('nav.upcoming')} subtitle={t('tasks.upcomingHint')} />
      {days.map((day) => {
        const dayTasks = tasks.filter((task) => task.due_date === day)
        return (
          <section key={day} aria-labelledby={`day-${day}`}>
            <SectionHeading id={`day-${day}`} count={dayTasks.length || undefined}>
              {dayLabel(day)}
            </SectionHeading>
            {dayTasks.length > 0 && <TaskList tasks={dayTasks} showProject />}
            <AddTask defaults={{ project_id: inboxId, due_date: day }} />
          </section>
        )
      })}
    </div>
  )
}
