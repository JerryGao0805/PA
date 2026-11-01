import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarDays, MoreHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { labelsQuery } from '@/features/labels/api'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { projectsQuery } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { cn } from '@/lib/utils'

import { isDone, isPendingTask, useUpdateTask, type Task } from './api'
import { describeDue, DUE_TONE_CLASS, PRIORITY_CHECKBOX_CLASS } from './due'
import { useDeleteWithUndo, useToggleDone } from './task-actions'
import { useToday } from './use-today'

interface TaskItemProps {
  task: Task
  /** 跨项目的列表（今天、即将到来、标签）里显示任务所属的项目 */
  showProject?: boolean
}

export function TaskItem({ task, showProject = false }: TaskItemProps) {
  const { t } = useTranslation()
  const toggle = useToggleDone()
  const pending = isPendingTask(task)
  const done = isDone(task)

  return (
    <li
      className={cn(
        // relative：标题链接的点击区域（after 伪元素）铺满整行，复选框和菜单浮在它上面
        'group/task relative flex min-h-11 items-start gap-3 border-b border-border/60 py-2.5',
        pending && 'opacity-60',
      )}
    >
      <Checkbox
        className={cn(
          'relative z-10 mt-0.5 size-[18px] rounded-full',
          PRIORITY_CHECKBOX_CLASS[task.priority],
        )}
        checked={done}
        disabled={pending}
        aria-label={
          done
            ? t('tasks.reopen', { title: task.title })
            : t('tasks.complete', { title: task.title })
        }
        onCheckedChange={() => toggle(task)}
      />

      <div className="grid min-w-0 flex-1 gap-1">
        {pending ? (
          <span className="truncate leading-snug">{task.title}</span>
        ) : (
          <Link
            to="."
            search={(prev) => ({ ...prev, task: task.id })}
            className={cn(
              'truncate rounded-sm leading-snug outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50',
              done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </Link>
        )}
        <TaskMeta task={task} showProject={showProject} />
      </div>

      {!pending && <TaskActions task={task} />}
    </li>
  )
}

/** 标题下面一行：截止日期、标签，以及（跨项目列表里）所属项目 */
function TaskMeta({ task, showProject }: { task: Task; showProject: boolean }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const due = isDone(task) ? null : describeDue(task, today, t, i18n.language)
  const taskLabels = labels.filter((l) => task.label_ids.includes(l.id))
  const project = showProject ? projects.find((p) => p.id === task.project_id) : undefined
  if (!due && taskLabels.length === 0 && !project) return null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {due && (
        <span className={cn('inline-flex items-center gap-1', DUE_TONE_CLASS[due.tone])}>
          <CalendarDays aria-hidden className="size-3.5" />
          <span className="sr-only">{t('tasks.detail.due')}</span>
          {due.text}
        </span>
      )}
      {taskLabels.map((label) => (
        <span key={label.id} className="inline-flex min-w-0 items-center gap-1">
          <LabelIcon color={label.color} className="size-3.5" />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {project && (
        <span className="ml-auto inline-flex min-w-0 items-center gap-1.5">
          <span className="sr-only">{t('tasks.detail.project')}</span>
          {!project.is_inbox && <ProjectDot color={project.color} className="size-2" />}
          <span className="truncate">{project.is_inbox ? t('nav.inbox') : project.name}</span>
        </span>
      )}
    </div>
  )
}

function TaskActions({ task }: { task: Task }) {
  const { t } = useTranslation()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const update = useUpdateTask()
  const destroy = useDeleteWithUndo()
  const moveTargets = projects.filter((p) => !p.archived && p.id !== task.project_id)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('tasks.actions')}
          className="relative z-10 -my-1 text-muted-foreground opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {!isDone(task) && moveTargets.length > 0 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('tasks.moveTo')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {moveTargets.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => update.mutate({ task, patch: { project_id: p.id } })}
                  >
                    {p.is_inbox ? null : <ProjectDot color={p.color} />}
                    <span className="truncate">{p.is_inbox ? t('nav.inbox') : p.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => destroy(task)}>
          <Trash2 />
          {t('tasks.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TaskList({ tasks, showProject }: { tasks: Task[]; showProject?: boolean }) {
  return (
    <ul className="border-t border-border/60">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} showProject={showProject} />
      ))}
    </ul>
  )
}
