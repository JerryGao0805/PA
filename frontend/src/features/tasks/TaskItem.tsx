import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarDays, ListChecks, MoreHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SortableList } from '@/components/sortable-list'
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
import { projectName, projectsQuery } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { useSortableItem, type SortableItem } from '@/lib/sortable'
import { cn } from '@/lib/utils'

import { isDone, isPendingTask, useMoveTask, useUpdateTask, type Task } from './api'
import { describeDue, DUE_TONE_CLASS, PRIORITY_CHECKBOX_CLASS } from './due'
import { STATUS_ICON, STATUS_TEXT_CLASS } from './status'
import { useDeleteWithUndo, useToggleDone } from './task-actions'
import { useToday } from './use-today'

interface TaskItemProps {
  task: Task
  /** 跨项目的列表（今天、即将到来、标签）里显示任务所属的项目 */
  showProject?: boolean
  /** row：列表里的一行；card：看板上的卡片（所在的列已经表示了状态，不再单独显示） */
  variant?: 'row' | 'card'
  /** 可以拖拽排序时由 SortableTaskItem 传入 */
  sortable?: SortableItem
}

export function TaskItem({ task, showProject = false, variant = 'row', sortable }: TaskItemProps) {
  const { t } = useTranslation()
  const toggle = useToggleDone()
  const pending = isPendingTask(task)
  const done = isDone(task)

  return (
    <li
      {...sortable?.row}
      className={cn(
        // relative：标题链接的点击区域（after 伪元素）铺满整行，复选框和菜单浮在它上面
        'group/task relative flex min-h-11 items-start gap-3',
        variant === 'row' && 'border-b border-border/60 bg-background py-2.5',
        variant === 'card' && 'rounded-lg border bg-card p-3 shadow-xs',
        pending && 'opacity-60',
        // 触屏上长按是拖拽，不要弹出文字选择和链接菜单
        sortable && 'touch-manipulation [@media(hover:none)]:select-none',
        // 列表里拖动的就是这一行；看板上拖动的是浮层里的副本，原位留一个占位
        sortable?.isDragging &&
          (variant === 'row'
            ? 'z-20 cursor-grabbing rounded-md shadow-lg ring-1 ring-border'
            : 'opacity-40'),
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
          <span className={cn('leading-snug', TITLE_CLAMP)}>{task.title}</span>
        ) : (
          <Link
            {...sortable?.handle}
            to="."
            search={(prev) => ({ ...prev, task: task.id })}
            draggable={false}
            className={cn(
              'rounded-sm leading-snug outline-none [-webkit-touch-callout:none] after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50',
              TITLE_CLAMP,
              done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </Link>
        )}
        <TaskMeta task={task} showProject={showProject} showStatus={variant === 'row'} />
      </div>

      {!pending && <TaskActions task={task} />}
    </li>
  )
}

/** 任务标题：桌面上一行放不下就省略；手机上屏幕窄，最多显示两行 */
const TITLE_CLAMP = 'truncate max-md:line-clamp-2 max-md:whitespace-normal max-md:wrap-break-word'

/** 标题下面一行：进行中、子任务进度、截止日期、标签，以及（跨项目列表里）所属项目 */
function TaskMeta({
  task,
  showProject,
  showStatus,
}: {
  task: Task
  showProject: boolean
  showStatus: boolean
}) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const due = isDone(task) ? null : describeDue(task, today, t, i18n.language)
  const taskLabels = labels.filter((l) => task.label_ids.includes(l.id))
  const project = showProject ? projects.find((p) => p.id === task.project_id) : undefined
  const hasSubtasks = task.subtask_count > 0
  const inProgress = showStatus && task.status === 'in_progress'
  if (!inProgress && !hasSubtasks && !due && taskLabels.length === 0 && !project) return null
  const StatusIcon = STATUS_ICON.in_progress

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {inProgress && (
        <span className={cn('inline-flex items-center gap-1', STATUS_TEXT_CLASS.in_progress)}>
          <StatusIcon aria-hidden className="size-3.5" />
          {t('tasks.status.in_progress')}
        </span>
      )}
      {hasSubtasks && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ListChecks aria-hidden className="size-3.5" />
          <span className="sr-only">
            {t('tasks.subtaskProgress', {
              done: task.done_subtask_count,
              total: task.subtask_count,
            })}
          </span>
          <span aria-hidden>
            {task.done_subtask_count}/{task.subtask_count}
          </span>
        </span>
      )}
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
          <span className="truncate">{projectName(project, t)}</span>
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
                    <span className="truncate">{projectName(p, t)}</span>
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

function SortableTaskItem(props: Omit<TaskItemProps, 'sortable'>) {
  // 还没保存好的新任务不能拖
  const sortable = useSortableItem(props.task.id, { disabled: isPendingTask(props.task) })
  return <TaskItem {...props} sortable={sortable} />
}

interface TaskListProps {
  tasks: Task[]
  showProject?: boolean
  /** 按手动顺序排列的列表（项目里、父任务下）可以拖拽排序 */
  sortable?: boolean
}

export function TaskList({ tasks, showProject, sortable = false }: TaskListProps) {
  if (sortable) return <SortableTaskList tasks={tasks} showProject={showProject} />
  return (
    <ul className="border-t border-border/60">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} showProject={showProject} />
      ))}
    </ul>
  )
}

function SortableTaskList({ tasks, showProject }: Omit<TaskListProps, 'sortable'>) {
  const move = useMoveTask()
  return (
    <SortableList
      items={tasks}
      getName={(task) => task.title}
      onMove={(task, _after, order) => move(task, order)}
    >
      {(shown) => (
        <ul className="border-t border-border/60">
          {shown.map((task) => (
            <SortableTaskItem key={task.id} task={task} showProject={showProject} />
          ))}
        </ul>
      )}
    </SortableList>
  )
}
