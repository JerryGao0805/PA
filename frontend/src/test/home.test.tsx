import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { HomePage } from '@/features/home/HomePage'

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

test('API 正常时显示连接成功', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'ok', database: 'ok' })),
  )
  renderHome()
  expect(await screen.findByText('API 与数据库连接正常')).toBeInTheDocument()
})

test('API 不可用时显示连接失败', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('down', { status: 503 })),
  )
  renderHome()
  expect(await screen.findByText('API 连接失败')).toBeInTheDocument()
})
