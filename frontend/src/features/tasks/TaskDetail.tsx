import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { CornerLeftUp, Flag, FolderInput, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { isSorting } from '@/lib/sortable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { projectsQuery, type Project } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { cn } from '@/lib/utils'

import {
  findCachedTask,
  isDone,
  tasksQuery,
  taskQuery,
  useUpdateTask,
  type Task,
  type TaskUpdate,
} from './api'
import { AddTask } from './AddTask'
import { CompletedTasks } from './CompletedTasks'
import { PRIORITIES, PRIORITY_CHECKBOX_CLASS, PRIORITY_TEXT_CLASS } from './due'
import { DuePicker } from './DuePicker'
import { LabelPicker } from './LabelPicker'
import { STATUS_ICON, STATUS_TEXT_CLASS, STATUSES } from './status'
import { useDeleteWithUndo, useToggleDone } from './task-actions'
import { TaskList } from './TaskItem'

const appRoute = getRouteApi('/_app')

/** 任务详情：URL 上带 ?task=<id> 时从右侧滑出。关闭 = 去掉这个参数，浏览器后退也能关闭 */
export function TaskDetail() {
  const { t } = useTranslation()
  const { task: taskId } = appRoute.useSearch()
  const navigate = useNavigate()
  const close = () =>
    void navigate({ to: '.', search: (prev) => ({ ...prev, task: undefined }), replace: true })

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        // 要带上和 shadcn 默认样式相同的 data-[side=right] 前缀才能覆盖它（默认是 3/4 宽）
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        onEscapeKeyDown={(e) => {
          // 正在编辑文字时，Esc 交给输入框处理（放弃修改）；正在拖动子任务时，Esc 取消拖动。
          // 这两种情况都不关闭面板
          const editing =
            document.activeElement instanceof HTMLTextAreaElement ||
            document.activeElement instanceof HTMLInputElement
          if (editing || isSorting()) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          // 点 toast（例如完成任务后的「撤销」）不算点了面板外面，不关闭面板
          if (e.target instanceof Element && e.target.closest('[data-sonner-toaster]')) {
            e.preventDefault()
          }
        }}
      >
        <SheetTitle className="sr-only">{t('tasks.detail.title')}</SheetTitle>
        <div className="flex justify-end p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('tasks.detail.close')}
            onClick={close}
          >
            <X />
          </Button>
        </div>
        {taskId && <TaskDetailBody key={taskId} id={taskId} onDeleted={close} />}
      </SheetContent>
    </Sheet>
  )
}

function TaskDetailBody({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // 先用列表里已有的数据显示，同时请求最新的
  const { data: task, isError } = useQuery({
    ...taskQuery(id),
    initialData: () => findCachedTask(queryClient, id),
  })

  if (!task) {
    return (
      <p className="px-6 text-sm text-muted-foreground">
        {isError ? t('tasks.detail.notFound') : t('common.loading')}
      </p>
    )
  }
  return <TaskFields task={task} onDeleted={onDeleted} />
}

function TaskFields({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const { t } = useTranslation()
  const update = useUpdateTask()
  const toggle = useToggleDone()
  const destroy = useDeleteWithUndo()
  const save = (patch: TaskUpdate) => update.mutate({ task, patch })
  const done = isDone(task)

  return (
    <div className="grid gap-6 px-6 pb-6">
      {task.parent_id && <ParentLink id={task.parent_id} />}
      <div className="flex items-start gap-3">
        <Checkbox
          className={cn('mt-1.5 size-5 rounded-full', PRIORITY_CHECKBOX_CLASS[task.priority])}
          checked={done}
          aria-label={
            done
              ? t('tasks.reopen', { title: task.title })
              : t('tasks.complete', { title: task.title })
          }
          onCheckedChange={() => toggle(task)}
        />
        <TitleField
          // 标题在别处被改了（例如撤销）时重新取初始值
          key={task.title}
          title={task.title}
          done={done}
          onSave={(title) => save({ title })}
        />
      </div>

      <DescriptionField
        key={task.description}
        description={task.description}
        onSave={(description) => save({ description })}
      />

      <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-2 gap-y-1 text-sm">
        <Property label={t('tasks.detail.project')}>
          <ProjectSelect task={task} onChange={(project_id) => save({ project_id })} />
        </Property>
        <Property label={t('tasks.status.label')}>
          <OptionSelect
            value={task.status}
            options={STATUSES.map((status) => {
              const Icon = STATUS_ICON[status]
              return {
                value: status,
                label: t(`tasks.status.${status}`),
                icon: <Icon className={STATUS_TEXT_CLASS[status]} />,
              }
            })}
            // 选「已完成」和勾选一样，可以撤销
            onChange={(status) => (status === 'done' ? toggle(task) : save({ status }))}
          />
        </Property>
        <Property label={t('tasks.detail.due')}>
          <DuePicker value={task} onChange={(due) => save(due)} />
        </Property>
        <Property label={t('tasks.priority.label')}>
          <OptionSelect<number>
            value={task.priority}
            options={PRIORITIES.map((p) => ({
              value: p,
              label: t(`tasks.priority.p${p}`),
              icon: <Flag className={PRIORITY_TEXT_CLASS[p]} />,
            }))}
            onChange={(priority) => save({ priority })}
          />
        </Property>
        <Property label={t('tasks.detail.labels')}>
          <LabelPicker value={task.label_ids} onChange={(label_ids) => save({ label_ids })} />
        </Property>
      </dl>

      {!task.parent_id && <Subtasks task={task} />}

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-destructive hover:text-destructive"
          onClick={() => {
            destroy(task)
            onDeleted()
          }}
        >
          <Trash2 />
          {t('tasks.detail.delete')}
        </Button>
      </div>
    </div>
  )
}

/** 子任务的详情里，回到父任务 */
function ParentLink({ id }: { id: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: parent } = useQuery({
    ...taskQuery(id),
    initialData: () => findCachedTask(queryClient, id),
  })

  return (
    <Link
      to="."
      search={(prev) => ({ ...prev, task: id })}
      className="-mt-2 -mb-3 flex min-w-0 items-center gap-1.5 self-start rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <CornerLeftUp aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">{t('tasks.parentTask')}</span>
      <span className="truncate">{parent?.title ?? t('common.loading')}</span>
    </Link>
  )
}

/** 子任务：可以拖拽排序；已完成的收在下面。父任务已完成时不能再添加 */
function Subtasks({ task }: { task: Task }) {
  const { t } = useTranslation()
  const { data: subtasks } = useQuery(tasksQuery({ parent_id: task.id }))

  return (
    <section aria-labelledby="subtasks-heading" className="grid gap-1">
      <h3 id="subtasks-heading" className="flex items-baseline gap-2 text-sm font-medium">
        {t('tasks.subtasks')}
        {task.subtask_count > 0 && (
          <span
            className="text-xs font-normal text-muted-foreground tabular-nums"
            aria-label={t('tasks.subtaskProgress', {
              done: task.done_subtask_count,
              total: task.subtask_count,
            })}
          >
            {task.done_subtask_count}/{task.subtask_count}
          </span>
        )}
      </h3>
      {subtasks && subtasks.length > 0 && <TaskList tasks={subtasks} sortable />}
      {!isDone(task) && (
        <AddTask
          defaults={{ project_id: task.project_id, parent_id: task.id }}
          label={t('tasks.addSubtask')}
          placeholder={t('tasks.subtaskPlaceholder')}
        />
      )}
      <CompletedTasks filter={{ parent_id: task.id }} count={task.done_subtask_count} />
    </section>
  )
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

/** 标题：直接在文本框里改，回车或离开时保存，Esc 放弃修改 */
function TitleField({
  title,
  done,
  onSave,
}: {
  title: string
  done: boolean
  onSave: (title: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(title)
  // Esc 放弃修改后会让输入框失去焦点，这次 blur 不保存
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) setDraft(title)
    else if (trimmed !== title) onSave(trimmed)
  }

  return (
    <textarea
      aria-label={t('tasks.titlePlaceholder')}
      value={draft}
      maxLength={500}
      rows={1}
      className={cn(
        'field-sizing-content min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 py-0.5 text-lg leading-snug font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        done && 'text-muted-foreground line-through',
      )}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          cancelled.current = true
          setDraft(title)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * 描述：显示时渲染 Markdown，点「编辑」切换成文本框。
 * 离开文本框时保存；正在编辑时关闭面板也会保存，不会丢掉写了一半的内容。
 */
function DescriptionField({
  description,
  onSave,
}: {
  description: string
  onSave: (description: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(description)
  // 卸载时（例如编辑中直接关闭面板）读取的最新状态
  const unsaved = useRef<{ draft: string; onSave: (d: string) => void } | null>(null)
  useEffect(() => {
    unsaved.current = editing && draft !== description ? { draft, onSave } : null
  })
  useEffect(
    () => () => {
      if (unsaved.current) unsaved.current.onSave(unsaved.current.draft)
    },
    [],
  )

  const finish = (save: boolean) => {
    // 先清掉，避免保存后组件因 key 变化卸载时再保存一次
    unsaved.current = null
    setEditing(false)
    if (save && draft !== description) onSave(draft)
    if (!save) setDraft(description)
  }

  if (editing) {
    return (
      <div className="grid gap-1.5">
        <Textarea
          aria-label={t('tasks.detail.description')}
          value={draft}
          maxLength={10_000}
          autoFocus
          placeholder={t('tasks.detail.descriptionPlaceholder')}
          className="min-h-28"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
            if (e.key === 'Escape') finish(false)
          }}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('tasks.detail.descriptionHint')}</span>
          {/* 点按钮会先让文本框失去焦点，由 onBlur 保存 */}
          <Button size="sm" variant="secondary">
            {t('tasks.detail.save')}
          </Button>
        </div>
      </div>
    )
  }

  if (!description) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md px-1 py-1 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {t('tasks.detail.descriptionPlaceholder')}
      </button>
    )
  }

  return (
    <div className="group/description relative">
      <div className="prose prose-sm max-w-none px-1 dark:prose-invert prose-a:text-primary">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            // 外部链接在新标签页打开
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          }}
        >
          {description}
        </Markdown>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('tasks.detail.editDescription')}
        title={t('tasks.detail.editDescription')}
        className="absolute -top-1 right-0 text-muted-foreground"
        onClick={() => setEditing(true)}
      >
        <Pencil />
      </Button>
    </div>
  )
}

function ProjectSelect({ task, onChange }: { task: Task; onChange: (projectId: string) => void }) {
  const { t } = useTranslation()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const current = projects.find((p) => p.id === task.project_id)
  // 已归档的项目不能作为移动目标，但当前所在的要能显示出来
  const options = projects.filter((p) => !p.archived || p.id === task.project_id)
  const name = (p: Project) => (p.is_inbox ? t('nav.inbox') : p.name)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 max-w-full justify-start font-normal">
          {current && !current.is_inbox ? (
            <ProjectDot color={current.color} />
          ) : (
            <FolderInput className="text-muted-foreground" />
          )}
          <span className="truncate">{current ? name(current) : ''}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
        <DropdownMenuRadioGroup value={task.project_id} onValueChange={onChange}>
          {options.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {!p.is_inbox && <ProjectDot color={p.color} />}
              <span className="truncate">{name(p)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 属性的下拉单选（状态、优先级）：按钮显示当前值，菜单里列出所有选项 */
function OptionSelect<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; icon: ReactNode }[]
  onChange: (value: T) => void
}) {
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 justify-start font-normal">
          {current?.icon}
          {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          value={String(value)}
          onValueChange={(next) => {
            const option = options.find((o) => String(o.value) === next)
            if (option) onChange(option.value)
          }}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={String(o.value)}>
              {o.icon}
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
