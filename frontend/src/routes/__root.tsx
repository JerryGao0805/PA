import { createRootRouteWithContext } from '@tanstack/react-router'

import { RootLayout } from '@/components/RootLayout'
import type { RouterContext } from '@/lib/router-context'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})
