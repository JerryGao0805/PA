import { useSuspenseQuery } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { meQuery } from '@/features/auth/api'
import { TaskDetail } from '@/features/tasks/TaskDetail'

import { AppSidebar } from './AppSidebar'
import { VerifyEmailBanner } from './VerifyEmailBanner'

export function AppLayout() {
  const { t } = useTranslation()
  // 路由的 beforeLoad 已确保用户已登录
  const { data: user } = useSuspenseQuery(meQuery)
  if (!user) return null

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center bg-background/80 px-2 backdrop-blur">
          <SidebarTrigger aria-label={t('nav.toggleSidebar')} title={t('nav.toggleSidebar')} />
        </header>
        {!user.email_verified && <VerifyEmailBanner email={user.email} />}
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-16 sm:px-8">
          <Outlet />
        </div>
      </SidebarInset>
      <TaskDetail />
    </SidebarProvider>
  )
}
