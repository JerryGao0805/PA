import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/api-error'

import { useDeleteLabel, type Label } from './api'
import { LabelDialog } from './LabelDialog'

/** 标签的操作菜单（编辑、删除），侧边栏和标签页共用 */
export function LabelMenu({ label, trigger }: { label: Label; trigger: ReactNode }) {
  const { t } = useTranslation()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            {t('labels.edit')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 />
            {t('labels.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LabelDialog open={editOpen} onOpenChange={setEditOpen} label={label} />
      <DeleteLabelDialog label={label} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}

function DeleteLabelDialog({
  label,
  open,
  onOpenChange,
}: {
  label: Label
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const remove = useDeleteLabel()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('labels.deleteDialog.title', { name: label.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('labels.deleteDialog.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('labels.form.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              // 等请求成功再关闭对话框
              event.preventDefault()
              remove.mutate(label.id, {
                onSuccess: () => {
                  onOpenChange(false)
                  // 正在看的标签被删除了，回到收件箱
                  if (pathname === `/labels/${label.id}`) {
                    void navigate({ to: '/inbox', replace: true })
                  }
                },
                onError: (err) => toast.error(errorMessage(t, err)),
              })
            }}
          >
            {t('labels.deleteDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
