import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Project } from '@/features/projects/api'
import { cn } from '@/lib/utils'

import { tasksQuery } from './api'
import { TaskItem } from './TaskItem'

// 和后端 DONE_LIST_LIMIT 一致
const DONE_LIST_LIMIT = 100

/** 已完成的任务：默认收起，展开时才加载 */
export function CompletedTasks({ project }: { project: Project }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (project.done_task_count === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        {t('tasks.completed')}
        <span className="tabular-nums">{project.done_task_count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{open && <DoneList project={project} />}</CollapsibleContent>
    </Collapsible>
  )
}

function DoneList({ project }: { project: Project }) {
  const { t } = useTranslation()
  const { data: tasks } = useQuery(tasksQuery({ project_id: project.id, done: true }))
  if (!tasks) return <p className="py-2 text-sm text-muted-foreground">{t('common.loading')}</p>

  return (
    <>
      <ul className="mt-1">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </ul>
      {project.done_task_count > DONE_LIST_LIMIT && (
        <p className="py-2 text-xs text-muted-foreground">{t('tasks.doneLimitHint')}</p>
      )}
    </>
  )
}
