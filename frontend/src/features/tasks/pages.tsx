import { useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { labelsQuery } from '@/features/labels/api'
import { findInbox, projectsQuery } from '@/features/projects/api'

import { LabelView } from './LabelView'
import { ProjectView } from './ProjectView'

export { TodayView as TodayPage, UpcomingView as UpcomingPage } from './DateViews'

export function InboxPage() {
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const inbox = findInbox(projects)
  // 服务端保证每个账号都有收件箱；这里只是类型上的兜底
  if (!inbox) return null
  return <ProjectView key={inbox.id} project={inbox} />
}

function NotFound({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid justify-items-start gap-4">
      <p className="text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link to="/inbox">{t('projects.backToInbox')}</Link>
      </Button>
    </div>
  )
}

const projectRoute = getRouteApi('/_app/projects/$projectId')

export function ProjectPage() {
  const { t } = useTranslation()
  const { projectId } = projectRoute.useParams()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const project = projects.find((p) => p.id === projectId)
  if (!project) return <NotFound message={t('projects.notFound')} />
  // key：切换项目时重置列表里的局部状态（例如展开的「已完成」）
  return <ProjectView key={project.id} project={project} />
}

const labelRoute = getRouteApi('/_app/labels/$labelId')

export function LabelPage() {
  const { t } = useTranslation()
  const { labelId } = labelRoute.useParams()
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const label = labels.find((l) => l.id === labelId)
  if (!label) return <NotFound message={t('labels.notFound')} />
  return <LabelView key={label.id} label={label} />
}
