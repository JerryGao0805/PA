import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  LogOut,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Logo } from '@/components/logo'
import { SortableList } from '@/components/sortable-list'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useLogout, type User } from '@/features/auth/api'
import { labelsQuery, type Label } from '@/features/labels/api'
import { LabelDialog } from '@/features/labels/LabelDialog'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { LabelMenu } from '@/features/labels/LabelMenu'
import { findInbox, projectsQuery, useMoveProject, type Project } from '@/features/projects/api'
import { ProjectDialog } from '@/features/projects/ProjectDialog'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { ProjectMenu } from '@/features/projects/ProjectMenu'
import { tasksQuery } from '@/features/tasks/api'
import { todayFilter, useToday } from '@/features/tasks/use-today'
import { errorMessage } from '@/lib/api-error'
import { useSortableItem, type SortableItem } from '@/lib/sortable'
import { cn } from '@/lib/utils'

export function AppSidebar({ user }: { user: User }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: labels } = useSuspenseQuery(labelsQuery)
  // 「今天」的计数（含逾期）；不阻塞侧边栏的渲染
  const { data: todayTasks } = useQuery(tasksQuery(todayFilter(useToday())))
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const closeOnMobile = useCloseOnMobile()
  const moveProject = useMoveProject()
  const [creating, setCreating] = useState(false)
  const [creatingLabel, setCreatingLabel] = useState(false)

  const inbox = findInbox(projects)
  const active = projects.filter((p) => !p.is_inbox && !p.archived)
  const archived = projects.filter((p) => !p.is_inbox && p.archived)

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link to="/inbox" onClick={closeOnMobile} className="w-fit">
          <Logo />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/inbox'}>
                <Link to="/inbox" onClick={closeOnMobile}>
                  <Inbox />
                  <span>{t('nav.inbox')}</span>
                </Link>
              </SidebarMenuButton>
              {inbox && inbox.open_task_count > 0 && (
                <SidebarMenuBadge>{inbox.open_task_count}</SidebarMenuBadge>
              )}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/today'}>
                <Link to="/today" onClick={closeOnMobile}>
                  <CalendarDays />
                  <span>{t('nav.today')}</span>
                </Link>
              </SidebarMenuButton>
              {!!todayTasks?.length && <SidebarMenuBadge>{todayTasks.length}</SidebarMenuBadge>}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/upcoming'}>
                <Link to="/upcoming" onClick={closeOnMobile}>
                  <CalendarRange />
                  <span>{t('nav.upcoming')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.projects')}</SidebarGroupLabel>
          <SidebarGroupAction title={t('projects.new')} onClick={() => setCreating(true)}>
            <Plus />
            <span className="sr-only">{t('projects.new')}</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SortableList
              items={active}
              getName={(project) => project.name}
              onMove={(project, after) =>
                moveProject.mutate(
                  { project, after },
                  { onError: (err) => toast.error(errorMessage(t, err)) },
                )
              }
            >
              {(shown) => (
                <SidebarMenu>
                  {shown.map((project) => (
                    <SortableProjectNavItem
                      key={project.id}
                      project={project}
                      pathname={pathname}
                    />
                  ))}
                </SidebarMenu>
              )}
            </SortableList>
            {active.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('projects.empty')}</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.labels')}</SidebarGroupLabel>
          <SidebarGroupAction title={t('labels.new')} onClick={() => setCreatingLabel(true)}>
            <Plus />
            <span className="sr-only">{t('labels.new')}</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {labels.map((label) => (
                <LabelNavItem key={label.id} label={label} pathname={pathname} />
              ))}
            </SidebarMenu>
            {labels.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('labels.empty')}</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {archived.length > 0 && (
          <Collapsible className="group/archived">
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="gap-1">
                  <ChevronRight className="transition-transform group-data-[state=open]/archived:rotate-90" />
                  {t('nav.archived')}
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {archived.map((project) => (
                      <ProjectNavItem key={project.id} project={project} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>

      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(project) => {
          closeOnMobile()
          void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
        }}
      />
      <LabelDialog
        open={creatingLabel}
        onOpenChange={setCreatingLabel}
        onCreated={(label) => {
          closeOnMobile()
          void navigate({ to: '/labels/$labelId', params: { labelId: label.id } })
        }}
      />
    </Sidebar>
  )
}

function SortableProjectNavItem(props: { project: Project; pathname: string }) {
  const sortable = useSortableItem(props.project.id)
  return <ProjectNavItem {...props} sortable={sortable} />
}

function ProjectNavItem({
  project,
  pathname,
  sortable,
}: {
  project: Project
  pathname: string
  /** 未归档的项目可以拖拽排序 */
  sortable?: SortableItem
}) {
  const { t } = useTranslation()
  const closeOnMobile = useCloseOnMobile()
  return (
    <SidebarMenuItem
      {...sortable?.row}
      className={cn(
        sortable && 'touch-manipulation [@media(hover:none)]:select-none',
        sortable?.isDragging && 'z-20 rounded-md bg-sidebar shadow-lg ring-1 ring-sidebar-border',
      )}
    >
      <SidebarMenuButton asChild isActive={pathname === `/projects/${project.id}`}>
        <Link
          {...sortable?.handle}
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          onClick={closeOnMobile}
          draggable={false}
          className={cn(
            '[-webkit-touch-callout:none]',
            project.archived && 'text-muted-foreground',
          )}
        >
          <ProjectDot color={project.color} className="mx-[3px]" />
          <span>{project.name}</span>
        </Link>
      </SidebarMenuButton>
      {project.open_task_count > 0 && (
        // 鼠标悬停时让位给右侧的操作按钮；触屏设备上操作按钮一直显示，计数往左挪
        <SidebarMenuBadge className="max-md:right-7 md:group-focus-within/menu-item:opacity-0 md:group-hover/menu-item:opacity-0">
          {project.open_task_count}
        </SidebarMenuBadge>
      )}
      <ProjectMenu
        project={project}
        trigger={
          <SidebarMenuAction showOnHover aria-label={t('projects.actions')}>
            <MoreHorizontal />
          </SidebarMenuAction>
        }
      />
    </SidebarMenuItem>
  )
}

function LabelNavItem({ label, pathname }: { label: Label; pathname: string }) {
  const { t } = useTranslation()
  const closeOnMobile = useCloseOnMobile()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname === `/labels/${label.id}`}>
        <Link to="/labels/$labelId" params={{ labelId: label.id }} onClick={closeOnMobile}>
          <LabelIcon color={label.color} />
          <span>{label.name}</span>
        </Link>
      </SidebarMenuButton>
      <LabelMenu
        label={label}
        trigger={
          <SidebarMenuAction showOnHover aria-label={t('labels.actions')}>
            <MoreHorizontal />
          </SidebarMenuAction>
        }
      />
    </SidebarMenuItem>
  )
}

function UserMenu({ user }: { user: User }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useLogout(() => navigate({ to: '/login', replace: true }))
  const name = user.display_name || user.email.split('@')[0]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t('nav.account')}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-medium uppercase">
                {name.slice(0, 1)}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-48"
          >
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
              <LogOut />
              {t('auth.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** 手机上侧边栏是抽屉，点了导航之后收起来 */
function useCloseOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar()
  return () => {
    if (isMobile) setOpenMobile(false)
  }
}
