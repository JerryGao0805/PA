import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { createApp } from '@/app'
import type { User } from '@/features/auth/api'

type Handler = (request: Request) => Response | Promise<Response>

/**
 * 用路由表 mock 掉 fetch。key 形如 "POST /api/v1/auth/login"。
 * 没有配置的接口返回 500，测试里一眼就能看出漏了什么。
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (request: Request) => {
    const key = `${request.method} ${new URL(request.url).pathname}`
    const text = await request.clone().text()
    calls.push({ key, body: text ? JSON.parse(text) : undefined })
    const handler = routes[key]
    if (!handler)
      return Response.json({ code: 'unknown', message: `unmocked ${key}` }, { status: 500 })
    return handler(request)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, callsTo: (key: string) => calls.filter((c) => c.key === key) }
}

export function renderApp(path: string) {
  const app = createApp(createMemoryHistory({ initialEntries: [path] }))
  render(<app.App />)
  return app
}

export const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status })
export const empty =
  (status = 204) =>
  () =>
    new Response(null, { status })
export const apiError = (status: number, code: string) => () =>
  Response.json({ code, message: code }, { status })

export const alice: User = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  display_name: 'Alice',
  email_verified: false,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  created_at: '2026-10-31T00:00:00Z',
}
