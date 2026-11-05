import { useSuspenseQuery } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { meQuery } from '@/features/auth/api'
import { CommandPaletteProvider } from '@/features/command-palette/CommandPalette'
import { QuickAddProvider } from '@/features/quick-add/QuickAdd'
import { TaskDetail } from '@/features/tasks/TaskDetail'

import { AppSidebar } from './AppSidebar'
import { VerifyEmailBanner } from './VerifyEmailBanner'

export function AppLayout() {
  const { t } = useTranslation()
  // 路由的 beforeLoad 已确保用户已登录
  const { data: user } = useSuspenseQuery(meQuery)
  if (!user) return null

  return (
    <QuickAddProvider>
      <CommandPaletteProvider>
        <SidebarProvider>
          <AppSidebar user={user} />
          <SidebarInset>
            <header className="sticky top-0 z-10 flex h-12 items-center bg-background/80 px-2 backdrop-blur">
              <SidebarTrigger aria-label={t('nav.toggleSidebar')} title={t('nav.toggleSidebar')} />
            </header>
            {!user.email_verified && <VerifyEmailBanner email={user.email} />}
            {/* 左右边距放在 --gutter 里，需要贴边横向滚动的内容（看板）可以用它抵消；
            页面里有 data-wide 的元素（看板）时内容区放宽 */}
            <div className="mx-auto w-full max-w-3xl flex-1 px-(--gutter) pt-4 pb-16 [--gutter:1rem] has-data-wide:max-w-6xl sm:[--gutter:2rem]">
              <Outlet />
            </div>
          </SidebarInset>
          <TaskDetail />
        </SidebarProvider>
      </CommandPaletteProvider>
    </QuickAddProvider>
  )
}
