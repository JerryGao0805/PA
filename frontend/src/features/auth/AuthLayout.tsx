import { Link, Outlet } from '@tanstack/react-router'

import { Logo } from '@/components/logo'

/** 登录、注册等页面的公共布局：居中的单列卡片 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-muted/40 px-4 py-12 sm:justify-center">
      <Link to="/" className="mb-8">
        <Logo />
      </Link>
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  )
}
