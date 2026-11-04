import { useSuspenseQuery } from '@tanstack/react-query'
import { List, MoreHorizontal, SquareKanban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { BoardView } from '@/features/board/BoardView'
import { useUpdateProject, type Project, type ProjectLayout } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { ProjectMenu } from '@/features/projects/ProjectMenu'
import { errorMessage } from '@/lib/api-error'

import { tasksQuery } from './api'
import { AddTask } from './AddTask'
import { CompletedTasks } from './CompletedTasks'
import { PageHeader } from './PageHeader'
import { TaskList } from './TaskItem'

/** 一个项目（或收件箱）：列表或看板，由项目自己记住 */
export function ProjectView({ project }: { project: Project }) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-6">
      <PageHeader
        title={project.is_inbox ? t('nav.inbox') : project.name}
        icon={!project.is_inbox && <ProjectDot color={project.color} className="size-3" />}
        actions={
          <>
            {!project.is_inbox && (
              <ProjectMenu
                project={project}
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={t('projects.actions')}>
                    <MoreHorizontal />
                  </Button>
                }
              />
            )}
            <LayoutToggle project={project} />
          </>
        }
      />

      {project.archived && <ArchivedBanner project={project} />}

      {project.layout === 'board' ? (
        <BoardView project={project} />
      ) : (
        <ProjectList project={project} />
      )}
    </div>
  )
}

function ProjectList({ project }: { project: Project }) {
  const { t } = useTranslation()
  const { data: tasks } = useSuspenseQuery(tasksQuery({ project_id: project.id }))

  return (
    <>
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
    </>
  )
}

const LAYOUTS = [
  { layout: 'list', Icon: List },
  { layout: 'board', Icon: SquareKanban },
] as const satisfies { layout: ProjectLayout; Icon: unknown }[]

/** 列表 / 看板切换。保存在项目上，换一台设备也是同样的视图 */
function LayoutToggle({ project }: { project: Project }) {
  const { t } = useTranslation()
  const update = useUpdateProject()

  return (
    <div
      role="group"
      aria-label={t('board.layout')}
      className="ml-auto flex shrink-0 rounded-lg bg-muted p-0.5"
    >
      {LAYOUTS.map(({ layout, Icon }) => (
        <Button
          key={layout}
          variant="ghost"
          size="sm"
          aria-pressed={project.layout === layout}
          title={t(`board.${layout}`)}
          className="h-7 px-2 text-muted-foreground hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
          onClick={() => {
            if (project.layout === layout) return
            update.mutate(
              { id: project.id, patch: { layout } },
              { onError: (err) => toast.error(errorMessage(t, err)) },
            )
          }}
        >
          <Icon />
          <span className="max-sm:sr-only">{t(`board.${layout}`)}</span>
        </Button>
      ))}
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
