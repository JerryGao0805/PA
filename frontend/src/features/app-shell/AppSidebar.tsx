import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronRight, ChevronsUpDown, Inbox, LogOut, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Logo } from '@/components/logo'
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
import { findInbox, projectsQuery, type Project } from '@/features/projects/api'
import { ProjectDialog } from '@/features/projects/ProjectDialog'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { ProjectMenu } from '@/features/projects/ProjectMenu'
import { cn } from '@/lib/utils'

export function AppSidebar({ user }: { user: User }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const closeOnMobile = useCloseOnMobile()
  const [creating, setCreating] = useState(false)

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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.projects')}</SidebarGroupLabel>
          <SidebarGroupAction title={t('projects.new')} onClick={() => setCreating(true)}>
            <Plus />
            <span className="sr-only">{t('projects.new')}</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {active.map((project) => (
                <ProjectNavItem key={project.id} project={project} pathname={pathname} />
              ))}
            </SidebarMenu>
            {active.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('projects.empty')}</p>
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
    </Sidebar>
  )
}

function ProjectNavItem({ project, pathname }: { project: Project; pathname: string }) {
  const { t } = useTranslation()
  const closeOnMobile = useCloseOnMobile()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname === `/projects/${project.id}`}>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          onClick={closeOnMobile}
          className={cn(project.archived && 'text-muted-foreground')}
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

function UserMenu({ user }: { user: User }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useLogout()
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
            <DropdownMenuItem
              disabled={logout.isPending}
              onSelect={() =>
                logout.mutate(undefined, {
                  onSettled: () => void navigate({ to: '/login', replace: true }),
                })
              }
            >
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
