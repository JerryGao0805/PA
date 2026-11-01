import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Flag, FolderInput, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

import { findCachedTask, isDone, taskQuery, useUpdateTask, type Task, type TaskUpdate } from './api'
import { PRIORITIES, PRIORITY_CHECKBOX_CLASS, PRIORITY_TEXT_CLASS } from './due'
import { DuePicker } from './DuePicker'
import { LabelPicker } from './LabelPicker'
import { useDeleteWithUndo, useToggleDone } from './task-actions'

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
          // 正在编辑文字时，Esc 交给输入框处理（放弃修改），不关闭面板
          if (document.activeElement instanceof HTMLTextAreaElement) e.preventDefault()
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
        <Property label={t('tasks.detail.due')}>
          <DuePicker value={task} onChange={(due) => save(due)} />
        </Property>
        <Property label={t('tasks.priority.label')}>
          <PrioritySelect value={task.priority} onChange={(priority) => save({ priority })} />
        </Property>
        <Property label={t('tasks.detail.labels')}>
          <LabelPicker value={task.label_ids} onChange={(label_ids) => save({ label_ids })} />
        </Property>
      </dl>

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

function PrioritySelect({
  value,
  onChange,
}: {
  value: number
  onChange: (priority: number) => void
}) {
  const { t } = useTranslation()
  const label = (p: number) => t(`tasks.priority.p${p as 1 | 2 | 3 | 4}`)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2 justify-start font-normal">
          <Flag className={PRIORITY_TEXT_CLASS[value]} />
          {label(value)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          value={String(value)}
          onValueChange={(next) => onChange(Number(next))}
        >
          {PRIORITIES.map((p) => (
            <DropdownMenuRadioItem key={p} value={String(p)}>
              <Flag className={PRIORITY_TEXT_CLASS[p]} />
              {label(p)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
