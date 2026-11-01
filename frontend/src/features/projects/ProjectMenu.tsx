import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/api-error'

import { useUpdateProject, type Project } from './api'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { ProjectDialog } from './ProjectDialog'

/**
 * 项目的操作菜单（编辑、归档、删除），侧边栏和项目页共用。
 * 对话框放在菜单外面渲染：菜单关闭时不会把对话框一起卸载。
 */
export function ProjectMenu({ project, trigger }: { project: Project; trigger: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const update = useUpdateProject()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const setArchived = (archived: boolean) =>
    update.mutate(
      { id: project.id, patch: { archived } },
      { onError: (err) => toast.error(errorMessage(t, err)) },
    )

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            {t('projects.edit')}
          </DropdownMenuItem>
          {project.archived ? (
            <DropdownMenuItem onSelect={() => setArchived(false)}>
              <ArchiveRestore />
              {t('projects.unarchive')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setArchived(true)}>
              <Archive />
              {t('projects.archive')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 />
            {t('projects.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          // 正在看的项目被删除了，回到收件箱
          if (pathname === `/projects/${project.id}`) void navigate({ to: '/inbox', replace: true })
        }}
      />
    </>
  )
}
