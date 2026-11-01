import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { meQuery, useLogout, type User } from '@/features/auth/api'

import { VerifyEmailBanner } from './VerifyEmailBanner'

export function AppLayout() {
  // 路由的 beforeLoad 已确保用户已登录
  const { data: user } = useSuspenseQuery(meQuery)
  if (!user) return null

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={user} />
      {!user.email_verified && <VerifyEmailBanner email={user.email} />}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

function AppHeader({ user }: { user: User }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useLogout()

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/">
          <Logo />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-muted-foreground" title={user.email}>
            {user.display_name || user.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('auth.logout')}
            title={t('auth.logout')}
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSettled: () => void navigate({ to: '/login', replace: true }),
              })
            }
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  )
}
