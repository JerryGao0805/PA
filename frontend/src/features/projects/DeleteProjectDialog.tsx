import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { errorMessage } from '@/lib/api-error'

import { useDeleteProject, type Project } from './api'

interface DeleteProjectDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation()
  const remove = useDeleteProject()
  const count = project.open_task_count + project.done_task_count

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('projects.deleteDialog.title', { name: project.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('projects.deleteDialog.description', { count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('projects.form.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              // 等请求成功再关闭对话框
              event.preventDefault()
              remove.mutate(project.id, {
                onSuccess: () => {
                  onOpenChange(false)
                  onDeleted?.()
                },
                onError: (err) => toast.error(errorMessage(t, err)),
              })
            }}
          >
            {t('projects.deleteDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
