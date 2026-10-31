import { Outlet } from '@tanstack/react-router'

export function RootLayout() {
  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <Outlet />
    </div>
  )
}
