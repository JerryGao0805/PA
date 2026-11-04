import { useSuspenseQuery } from '@tanstack/react-query'
import { useParams, useRouterState } from '@tanstack/react-router'
import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { findInbox, projectsQuery } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { useCreateTask, type NewTask } from '@/features/tasks/api'
import { useToday } from '@/features/tasks/use-today'

import { OpenQuickAdd } from './open-quick-add'
import { TaskInput, TokenChips } from './TaskInput'
import { taskFromInput, useTaskInput } from './use-task-input'

/**
 * 焦点在可以输入文字的地方、菜单或列表里时，按 Q 是在打字；在弹窗里时不再叠一层。
 * 这些时候都不打开快速添加
 */
function ignoresQ(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    !!target.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]')
  )
}

/** 快速添加：在任何页面按 Q（或点侧边栏上的按钮）打开 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'q' && e.key !== 'Q') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return
      if (ignoresQ(e.target)) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <OpenQuickAdd value={() => setOpen(true)}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <QuickAddDialog onDone={() => setOpen(false)} />}
      </Dialog>
    </OpenQuickAdd>
  )
}

/** 默认值和当前页面里的「添加任务」一样：项目页加到这个项目，标签页带上这个标签，「今天」默认今天 */
function usePageDefaults(): Omit<NewTask, 'title'> {
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const today = useToday()
  const params = useParams({ strict: false })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const inboxId = findInbox(projects)?.id ?? ''

  if (params.projectId && projects.some((p) => p.id === params.projectId)) {
    return { project_id: params.projectId }
  }
  if (params.labelId) return { project_id: inboxId, label_ids: [params.labelId] }
  if (pathname === '/today') return { project_id: inboxId, due_date: today }
  return { project_id: inboxId }
}

function QuickAddDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const defaults = usePageDefaults()
  const create = useCreateTask()
  const state = useTaskInput()
  const inputRef = useRef<HTMLInputElement>(null)
  const task = taskFromInput(defaults, state.parsed)
  const project = state.projectById(task.project_id)
  const projectName = project?.name ?? ''

  return (
    <DialogContent
      showCloseButton={false}
      className="top-[20%] translate-y-0 gap-3 sm:max-w-xl"
      // 打开时焦点放在输入框里
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('quickAdd.title')}</DialogTitle>
        <DialogDescription>{t('quickAdd.description')}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!task.title) return
          create.mutate(task)
          toast(t('quickAdd.addedTo', { project: projectName }))
          onDone()
        }}
      >
        <TaskInput
          state={state}
          inputRef={inputRef}
          label={t('tasks.titlePlaceholder')}
          placeholder={t('quickAdd.placeholder')}
        />
        <TokenChips state={state} />
        <DialogFooter className="items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            {t('quickAdd.addTo')}
            <span className="flex items-center gap-1.5 text-foreground">
              {project?.is_inbox ? (
                <Inbox aria-hidden className="size-4 text-muted-foreground" />
              ) : (
                project && <ProjectDot color={project.color} />
              )}
              {projectName}
            </span>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              {t('tasks.cancel')}
            </Button>
            <Button type="submit" disabled={!task.title}>
              {t('tasks.addSubmit')}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
