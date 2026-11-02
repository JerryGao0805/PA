import { useSuspenseQuery } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { Label } from '@/features/labels/api'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { LabelMenu } from '@/features/labels/LabelMenu'
import { findInbox, projectsQuery } from '@/features/projects/api'

import { tasksQuery } from './api'
import { AddTask } from './AddTask'
import { PageHeader } from './PageHeader'
import { TaskList } from './TaskItem'

/** 带某个标签的未完成任务（跨项目） */
export function LabelView({ label }: { label: Label }) {
  const { t } = useTranslation()
  const { data: tasks } = useSuspenseQuery(tasksQuery({ label_id: label.id }))
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const inboxId = findInbox(projects)?.id ?? ''

  return (
    <div className="grid gap-6">
      <PageHeader
        title={label.name}
        icon={<LabelIcon color={label.color} className="size-5" />}
        actions={
          <LabelMenu
            label={label}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={t('labels.actions')}>
                <MoreHorizontal />
              </Button>
            }
          />
        }
      />
      <section>
        {tasks.length > 0 ? (
          <TaskList tasks={tasks} showProject />
        ) : (
          <p className="pb-2 text-sm text-muted-foreground">{t('labels.tasksEmpty')}</p>
        )}
        <AddTask defaults={{ project_id: inboxId, label_ids: [label.id] }} />
      </section>
    </div>
  )
}
