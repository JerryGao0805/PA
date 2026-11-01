import { MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import type { Project } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { cn } from '@/lib/utils'

import { isPendingTask, useDeleteTask, useRestoreTask, useUpdateTask, type Task } from './api'

interface TaskItemProps {
  task: Task
  /** 「移动到」菜单里可选的项目 */
  projects: Project[]
}

export function TaskItem({ task, projects }: TaskItemProps) {
  const { t } = useTranslation()
  const update = useUpdateTask()
  const remove = useDeleteTask()
  const restore = useRestoreTask()
  const [editing, setEditing] = useState(false)
  const pending = isPendingTask(task)
  const done = task.status === 'done'

  const toggle = () => {
    if (done) {
      update.mutate({ task, patch: { status: 'todo' } })
      return
    }
    update.mutate({ task, patch: { status: 'done' } })
    // 任务会立刻移到「已完成」里，给一个撤销的机会
    const completed: Task = { ...task, status: 'done', completed_at: new Date().toISOString() }
    toast(t('tasks.completedToast', { title: task.title }), {
      action: {
        label: t('tasks.undo'),
        onClick: () => update.mutate({ task: completed, patch: { status: 'todo' } }),
      },
    })
  }

  const rename = (title: string) => {
    setEditing(false)
    const trimmed = title.trim()
    if (trimmed && trimmed !== task.title) update.mutate({ task, patch: { title: trimmed } })
  }

  const destroy = () => {
    remove.mutate(task)
    toast(t('tasks.deletedToast', { title: task.title }), {
      action: { label: t('tasks.undo'), onClick: () => restore.mutate(task) },
    })
  }

  const moveTargets = projects.filter((p) => !p.archived && p.id !== task.project_id)

  return (
    <li
      className={cn(
        'group/task flex min-h-11 items-center gap-3 border-b border-border/60 py-1.5',
        pending && 'opacity-60',
      )}
    >
      <Checkbox
        className="size-[18px] rounded-full border-muted-foreground/80"
        checked={done}
        disabled={pending}
        aria-label={
          done
            ? t('tasks.reopen', { title: task.title })
            : t('tasks.complete', { title: task.title })
        }
        onCheckedChange={toggle}
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            aria-label={t('tasks.titlePlaceholder')}
            defaultValue={task.title}
            maxLength={500}
            autoFocus
            className="w-full rounded-sm bg-transparent py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) rename(e.currentTarget.value)
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            disabled={pending || done}
            aria-label={t('tasks.edit', { title: task.title })}
            onClick={() => setEditing(true)}
            className={cn(
              'w-full truncate rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default',
              done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </button>
        )}
      </div>

      {!pending && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('tasks.actions')}
              className="text-muted-foreground opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {!done && moveTargets.length > 0 && (
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
            <DropdownMenuItem variant="destructive" onSelect={destroy}>
              <Trash2 />
              {t('tasks.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}
