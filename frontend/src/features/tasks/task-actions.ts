import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { isDone, useDeleteTask, useRestoreTask, useUpdateTask, type Task } from './api'

/**
 * 标记完成；已经完成的不动。完成后任务会立刻移到「已完成」里，所以给一个撤销的机会：
 * 撤销后回到原来的状态（待办或进行中）
 */
function completeWithUndo(update: ReturnType<typeof useUpdateTask>, t: TFunction, task: Task) {
  if (isDone(task)) return
  update.mutate({ task, patch: { status: 'done' } })
  const completed: Task = { ...task, status: 'done', completed_at: new Date().toISOString() }
  toast(t('tasks.completedToast', { title: task.title }), {
    action: {
      label: t('tasks.undo'),
      onClick: () => update.mutate({ task: completed, patch: { status: task.status } }),
    },
  })
}

/** 标记完成（看板上拖到「已完成」、详情里选「已完成」），可以撤销 */
export function useCompleteTask() {
  const { t } = useTranslation()
  const update = useUpdateTask()
  return (task: Task) => completeWithUndo(update, t, task)
}

/** 勾选 / 取消勾选。每一行任务都有一个，所以只用一个 useUpdateTask，不再套 useCompleteTask */
export function useToggleDone() {
  const { t } = useTranslation()
  const update = useUpdateTask()
  return (task: Task) => {
    if (isDone(task)) update.mutate({ task, patch: { status: 'todo' } })
    else completeWithUndo(update, t, task)
  }
}

/** 删除（软删除），提示里可以撤销 */
export function useDeleteWithUndo() {
  const { t } = useTranslation()
  const remove = useDeleteTask()
  const restore = useRestoreTask()
  return (task: Task) => {
    remove.mutate(task)
    toast(t('tasks.deletedToast', { title: task.title }), {
      action: { label: t('tasks.undo'), onClick: () => restore.mutate(task) },
    })
  }
}
