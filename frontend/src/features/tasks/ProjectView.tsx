import { useSuspenseQuery } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useUpdateProject, type Project } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { ProjectMenu } from '@/features/projects/ProjectMenu'
import { errorMessage } from '@/lib/api-error'

import { tasksQuery } from './api'
import { AddTask } from './AddTask'
import { CompletedTasks } from './CompletedTasks'
import { PageHeader } from './PageHeader'
import { TaskList } from './TaskItem'

/** 一个项目（或收件箱）的任务列表 */
export function ProjectView({ project }: { project: Project }) {
  const { t } = useTranslation()
  const { data: tasks } = useSuspenseQuery(tasksQuery({ project_id: project.id }))

  return (
    <div className="grid gap-6">
      <PageHeader
        title={project.is_inbox ? t('nav.inbox') : project.name}
        icon={!project.is_inbox && <ProjectDot color={project.color} className="size-3" />}
        actions={
          !project.is_inbox && (
            <ProjectMenu
              project={project}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label={t('projects.actions')}>
                  <MoreHorizontal />
                </Button>
              }
            />
          )
        }
      />

      {project.archived && <ArchivedBanner project={project} />}

      <section>
        {tasks.length > 0 ? (
          <TaskList tasks={tasks} sortable />
        ) : (
          <p className="pb-2 text-sm text-muted-foreground">
            {project.is_inbox ? t('tasks.inboxEmpty') : t('tasks.empty')}
          </p>
        )}
        <AddTask defaults={{ project_id: project.id }} />
      </section>

      <CompletedTasks filter={{ project_id: project.id }} count={project.done_task_count} />
    </div>
  )
}

function ArchivedBanner({ project }: { project: Project }) {
  const { t } = useTranslation()
  const update = useUpdateProject()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      <span className="flex-1">{t('projects.archivedBanner')}</span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        onClick={() =>
          update.mutate(
            { id: project.id, patch: { archived: false } },
            { onError: (err) => toast.error(errorMessage(t, err)) },
          )
        }
      >
        {t('projects.unarchive')}
      </Button>
    </div>
  )
}
