import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { TaskInput, TokenChips } from '@/features/quick-add/TaskInput'
import { taskFromInput, useTaskInput } from '@/features/quick-add/use-task-input'

import { useCreateTask, type NewTask } from './api'

interface AddTaskProps {
  /** 新任务的项目和其他默认值，例如在「今天」里添加的任务默认今天到期，子任务带上 parent_id */
  defaults: Omit<NewTask, 'title'>
  /** 收起时按钮上的文字，默认「添加任务」 */
  label?: string
  /** 输入框的提示（也是它的名字），默认「任务名称」 */
  placeholder?: string
}

/**
 * 列表底部的「添加任务」：提交后保持展开，方便连续添加；Esc 收起。
 * 输入里的日期、#项目、@标签、!优先级会被识别出来（见 features/quick-add），优先于这里的默认值
 */
export function AddTask({ defaults, label, placeholder }: AddTaskProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-3 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Plus className="size-[18px]" />
        {label ?? t('tasks.add')}
      </button>
    )
  }
  return (
    <AddTaskForm
      defaults={defaults}
      placeholder={placeholder ?? t('tasks.titlePlaceholder')}
      onClose={() => setOpen(false)}
    />
  )
}

function AddTaskForm({
  defaults,
  placeholder,
  onClose,
}: Required<Omit<AddTaskProps, 'label'>> & { onClose: () => void }) {
  const { t } = useTranslation()
  const create = useCreateTask()
  // 子任务总是在父任务的项目里，不能用 # 指定
  const state = useTaskInput({ allowProject: !defaults.parent_id })
  const inputRef = useRef<HTMLInputElement>(null)
  const task = taskFromInput(defaults, state.parsed)

  return (
    <form
      className="flex flex-wrap items-start gap-2 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!task.title) return
        create.mutate(task)
        // 加到了别的项目：这个列表里看不到它，告诉用户去了哪里
        if (task.project_id !== defaults.project_id) {
          const project = state.projectById(task.project_id)
          toast(t('quickAdd.addedTo', { project: project?.name ?? '' }))
        }
        state.reset()
        inputRef.current?.focus()
      }}
    >
      <div className="grid min-w-48 flex-1 gap-2">
        <TaskInput
          state={state}
          inputRef={inputRef}
          label={placeholder}
          placeholder={placeholder}
          autoFocus
          onEscape={onClose}
        />
        <TokenChips state={state} />
      </div>
      {/* 两个按钮一起换行：窄的地方（例如看板的一列）输入框占满一行，按钮在下一行 */}
      <div className="flex gap-2">
        <Button type="submit" disabled={!task.title}>
          {t('tasks.addSubmit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('tasks.cancel')}
        </Button>
      </div>
    </form>
  )
}
