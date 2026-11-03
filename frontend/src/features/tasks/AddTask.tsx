import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useCreateTask, type NewTask } from './api'

interface AddTaskProps {
  /** 新任务的项目和其他默认值，例如在「今天」里添加的任务默认今天到期，子任务带上 parent_id */
  defaults: Omit<NewTask, 'title'>
  /** 收起时按钮上的文字，默认「添加任务」 */
  label?: string
  /** 输入框的提示（也是它的名字），默认「任务名称」 */
  placeholder?: string
}

/** 列表底部的「添加任务」：提交后保持展开，方便连续添加；Esc 收起 */
export function AddTask({ defaults, label, placeholder }: AddTaskProps) {
  const { t } = useTranslation()
  const create = useCreateTask()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setOpen(false)
    setTitle('')
  }

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
    <form
      className="flex flex-wrap items-center gap-2 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        create.mutate({ ...defaults, title })
        setTitle('')
        inputRef.current?.focus()
      }}
    >
      <Input
        ref={inputRef}
        aria-label={placeholder ?? t('tasks.titlePlaceholder')}
        placeholder={placeholder ?? t('tasks.titlePlaceholder')}
        value={title}
        maxLength={500}
        autoFocus
        autoComplete="off"
        className="min-w-48 flex-1"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      />
      <Button type="submit" disabled={!title.trim()}>
        {t('tasks.addSubmit')}
      </Button>
      <Button type="button" variant="ghost" onClick={close}>
        {t('tasks.cancel')}
      </Button>
    </form>
  )
}
