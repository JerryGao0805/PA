/** M4：Cmd/Ctrl+K 搜索和跳转 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  apiError,
  fakeBackend,
  inbox,
  makeLabel,
  makeProject,
  makeTask,
  mockApi,
  renderApp,
  signedIn,
} from './render-app'

afterEach(() => vi.restoreAllMocks())

const work = makeProject({ id: 'p-work', name: '工作', color: 'blue' })
const shelved = makeProject({ id: 'p-old', name: '旧工作', color: 'gray', archived: true })
const important = makeLabel({ id: 'l-important', name: '重要', color: 'red' })
const report = makeTask({ id: 't-report', title: '体检报告', project_id: work.id })
const booking = makeTask({
  id: 't-booking',
  title: '预约',
  description: '年度体检',
  project_id: inbox.id,
})
const done = makeTask({
  id: 't-done',
  title: '体检缴费',
  project_id: work.id,
  status: 'done',
  completed_at: '2026-11-01T00:00:00Z',
})

function setup(routes = {}) {
  const backend = fakeBackend({
    projects: [inbox, work, shelved],
    tasks: [report, booking, done],
    labels: [important],
  })
  const api = mockApi(signedIn({ ...backend.routes, ...routes }))
  return { api, backend }
}

const searchBox = () => screen.getByRole('combobox', { name: '搜索和跳转' })
const optionsIn = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('option')
    .map((o) => o.textContent)

// jsdom 的 navigator.platform 是空的（不是 Mac），快捷键是 Ctrl+K
async function openPalette() {
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '收件箱' })
  await user.keyboard('{Control>}k{/Control}')
  await screen.findByRole('dialog', { name: '搜索和跳转' })
  return user
}

test('Ctrl+K 打开：列出操作、页面、项目和标签；输入时筛选，回车跳转', async () => {
  setup()
  const { router } = renderApp('/inbox')
  const user = await openPalette()

  expect(searchBox()).toHaveFocus()
  expect(optionsIn('操作')).toEqual(['快速添加任务Q'])
  expect(optionsIn('跳转')).toEqual(['收件箱', '今天', '即将到来', '设置'])
  // 没输入时只有侧边栏上的项目（不含归档的）
  expect(optionsIn('项目')).toEqual(['工作'])
  expect(optionsIn('标签')).toEqual(['重要'])

  await user.type(searchBox(), '工作')
  // 输入了也能找到归档的项目
  expect(optionsIn('项目')).toEqual(['工作', '旧工作已归档'])
  expect(screen.queryByRole('group', { name: '跳转' })).toBeNull()

  // 第一项默认选中：回车跳到「工作」
  await user.keyboard('{Enter}')
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${work.id}`))
  expect(screen.queryByRole('dialog', { name: '搜索和跳转' })).toBeNull()
})

test('搜索任务：标题或描述里有的都找出来，选中后跳到所在项目并打开详情', async () => {
  const { api } = setup()
  const { router } = renderApp('/inbox')
  const user = await openPalette()

  await user.type(searchBox(), '体检')
  // 输入停下来以后才请求，只请求一次
  await waitFor(() =>
    expect(optionsIn('任务')).toEqual(['体检报告工作', '预约收件箱', '体检缴费工作']),
  )
  expect(api.callsTo('GET /api/v1/tasks/search').map((c) => c.query.get('q'))).toEqual(['体检'])

  await user.click(screen.getByRole('option', { name: /体检报告/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${work.id}`))
  expect(router.state.location.search).toEqual({ task: report.id })
  const panel = await screen.findByRole('dialog', { name: '任务详情' })
  expect(within(panel).getByRole('textbox', { name: '任务名称' })).toHaveValue('体检报告')
  expect(screen.queryByRole('dialog', { name: '搜索和跳转' })).toBeNull()
})

test('收件箱里的任务跳到收件箱', async () => {
  setup()
  const { router } = renderApp('/today')
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '今天' })
  await user.keyboard('{Control>}k{/Control}')

  await user.type(searchBox(), '年度')
  await user.click(await screen.findByRole('option', { name: /预约/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'))
  expect(router.state.location.search).toEqual({ task: booking.id })
})

test('搜索失败时给出提示', async () => {
  setup({ 'GET /api/v1/tasks/search': apiError(500, 'unknown') })
  renderApp('/inbox')
  const user = await openPalette()

  await user.type(searchBox(), '体检')
  expect(await screen.findByText('搜索失败，请稍后再试')).toBeInTheDocument()
})

test('没有匹配的内容', async () => {
  setup()
  renderApp('/inbox')
  const user = await openPalette()

  await user.type(searchBox(), '找不到的东西')
  expect(await screen.findByText('没有找到相关的内容')).toBeInTheDocument()
  expect(screen.queryAllByRole('option')).toEqual([])
})

test('新结果回来之前，上一次的结果按现在的文字筛过再显示', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = await openPalette()

  await user.type(searchBox(), '体检')
  await waitFor(() =>
    expect(optionsIn('任务')).toEqual(['体检报告工作', '预约收件箱', '体检缴费工作']),
  )
  // 接着往后打字：还没发新请求，结果已经变少了
  await user.type(searchBox(), '报告')
  expect(optionsIn('任务')).toEqual(['体检报告工作'])

  // 清空后马上换一个不相关的词：旧结果不显示，回车选中的是筛出来的项目，不是旧的任务
  await user.clear(searchBox())
  await user.type(searchBox(), '工作')
  expect(screen.queryByRole('group', { name: '任务' })).toBeNull()
  expect(optionsIn('项目')).toEqual(['工作', '旧工作已归档'])
  await waitFor(() =>
    expect(api.callsTo('GET /api/v1/tasks/search').map((c) => c.query.get('q'))).toContain('工作'),
  )
  expect(screen.queryByRole('group', { name: '任务' })).toBeNull()
})

test('关键词最多 200 个字（和后端一致，超了会返回 422）', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = await openPalette()

  await user.paste('体'.repeat(250))
  expect(searchBox()).toHaveValue('体'.repeat(200))
  await waitFor(() =>
    expect(api.callsTo('GET /api/v1/tasks/search').map((c) => c.query.get('q'))).toEqual([
      '体'.repeat(200),
    ]),
  )
})

test('再按一次 Cmd/Ctrl+K 关闭；在输入框里也能打开', async () => {
  setup()
  renderApp('/inbox')
  const user = await openPalette()

  await user.keyboard('{Control>}k{/Control}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和跳转' })).toBeNull())

  await user.click(screen.getByRole('button', { name: '添加任务' }))
  await user.type(screen.getByRole('combobox', { name: '任务名称' }), '写')
  await user.keyboard('{Control>}k{/Control}')
  expect(await screen.findByRole('dialog', { name: '搜索和跳转' })).toBeInTheDocument()
})

test('Mac 上只认 Cmd+K（Ctrl+K 留给输入框「删到行尾」），其他系统只认 Ctrl+K', async () => {
  setup()
  renderApp('/inbox')
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '收件箱' })
  const palette = () => screen.queryByRole('dialog', { name: '搜索和跳转' })

  await user.keyboard('{Meta>}k{/Meta}')
  expect(palette()).toBeNull()

  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  await user.keyboard('{Control>}k{/Control}')
  expect(palette()).toBeNull()
  await user.keyboard('{Meta>}k{/Meta}')
  expect(await screen.findByRole('dialog', { name: '搜索和跳转' })).toBeInTheDocument()
})

test('别的对话框开着时不打开；任务详情里可以打开，选别的任务就换过去', async () => {
  setup()
  const { router } = renderApp(`/projects/${work.id}`)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '工作' })
  const palette = () => screen.queryByRole('dialog', { name: '搜索和跳转' })

  // 快速添加里打了一半
  await user.keyboard('q')
  const quickAdd = await screen.findByRole('dialog', { name: '快速添加任务' })
  await user.type(within(quickAdd).getByRole('combobox', { name: '任务名称' }), '写')
  await user.keyboard('{Control>}k{/Control}')
  expect(palette()).toBeNull()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '快速添加任务' })).toBeNull())

  // 任务详情
  await user.click(screen.getByRole('link', { name: '体检报告' }))
  const detail = await screen.findByRole('dialog', { name: '任务详情' })
  await user.click(within(detail).getByRole('textbox', { name: '任务名称' }))
  await user.keyboard('{Control>}k{/Control}')
  await screen.findByRole('dialog', { name: '搜索和跳转' })
  await user.type(searchBox(), '年度')
  await user.click(await screen.findByRole('option', { name: /预约/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'))
  expect(router.state.location.search).toEqual({ task: booking.id })
  expect(
    within(await screen.findByRole('dialog', { name: '任务详情' })).getByRole('textbox', {
      name: '任务名称',
    }),
  ).toHaveValue('预约')
})

test('从搜索面板打开快速添加；侧边栏上的按钮也能打开搜索面板', async () => {
  setup()
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '搜索' }))
  await screen.findByRole('dialog', { name: '搜索和跳转' })
  await user.click(screen.getByRole('option', { name: /快速添加任务/ }))

  const dialog = await screen.findByRole('dialog', { name: '快速添加任务' })
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: '任务名称' })).toHaveFocus(),
  )
  expect(screen.queryByRole('dialog', { name: '搜索和跳转' })).toBeNull()
})

test('手机上：顶栏的「搜索」打开搜索面板，右下角的「快速添加」打开快速添加', async () => {
  // 侧边栏按窗口宽度判断是不是手机（jsdom 默认 1024）
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
  setup()
  renderApp('/inbox')
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '收件箱' })

  // 侧边栏收在抽屉里，这两个按钮各只有一个
  await user.click(screen.getByRole('button', { name: '搜索' }))
  await screen.findByRole('dialog', { name: '搜索和跳转' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索和跳转' })).toBeNull())

  await user.click(screen.getByRole('button', { name: '快速添加' }))
  expect(await screen.findByRole('dialog', { name: '快速添加任务' })).toBeInTheDocument()
})
