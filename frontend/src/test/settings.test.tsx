/** M5：设置页（昵称、时区、修改密码、删除账户） */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { alice, apiError, empty, mockApi, renderApp, signedIn, type Handler } from './render-app'

// 2026-11-04 02:00 UTC：上海已经是 11 月 4 日，纽约（冬令时 UTC-5）还是 11 月 3 日
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T02:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup(routes: Record<string, Handler> = {}) {
  let me = { ...alice }
  return mockApi(
    signedIn({
      'GET /api/v1/auth/me': () => Response.json(me),
      'PATCH /api/v1/account': async (request) => {
        me = { ...me, ...((await request.json()) as Partial<typeof me>) }
        return Response.json(me)
      },
      'POST /api/v1/auth/change-password': empty(),
      'POST /api/v1/account/delete': empty(),
      ...routes,
    }),
  )
}

/** 第一次调用返回 err，之后都成功 */
const failOnce = (err: Handler): Handler => {
  let calls = 0
  return (request, params) => (calls++ === 0 ? err(request, params) : empty()())
}

/** 假装这台设备在 timeZone */
function deviceIn(timeZone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone }
  })
}

const section = (name: string) => screen.findByRole('region', { name })
const timezonePicker = (profile: HTMLElement) =>
  within(profile).getByRole('combobox', { name: '时区' })

test('从账号菜单打开设置：显示邮箱、昵称和时区', async () => {
  setup()
  const { router } = renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '账号菜单' }))
  await user.click(screen.getByRole('menuitem', { name: '设置' }))
  expect(await screen.findByRole('heading', { level: 1, name: '设置' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/settings')

  const profile = await section('个人资料')
  expect(within(profile).getByLabelText('邮箱未验证')).toHaveValue('alice@example.com')
  expect(within(profile).getByLabelText('昵称')).toHaveValue('Alice')
  expect(timezonePicker(profile)).toHaveTextContent('Asia/ShanghaiUTC+8')
  // 没改过不能保存
  expect(within(profile).getByRole('button', { name: '保存' })).toBeDisabled()
})

test('改昵称和时区：侧边栏的名字跟着变，「今天」按新时区算', async () => {
  const api = setup()
  renderApp('/settings')
  const user = userEvent.setup()
  const profile = await section('个人资料')
  const dueTo = () => api.callsTo('GET /api/v1/tasks').map((c) => c.query.get('due_to'))
  await waitFor(() => expect(dueTo()).toContain('2026-11-04'))

  await user.clear(within(profile).getByLabelText('昵称'))
  await user.type(within(profile).getByLabelText('昵称'), '  Alice Li ')
  // 时区可以搜城市名（不用写下划线）
  await user.click(timezonePicker(profile))
  await user.type(screen.getByPlaceholderText(/搜索城市/), 'new york')
  await user.click(screen.getByRole('option', { name: /America\/New York/ }))
  expect(timezonePicker(profile)).toHaveTextContent('America/New YorkUTC-5')

  await user.click(within(profile).getByRole('button', { name: '保存' }))
  expect(await screen.findByText('已保存')).toBeInTheDocument()
  expect(api.callsTo('PATCH /api/v1/account').map((c) => c.body)).toEqual([
    { display_name: 'Alice Li', timezone: 'America/New_York' },
  ])
  expect(screen.getByRole('button', { name: '账号菜单' })).toHaveTextContent('Alice Li')
  expect(within(profile).getByRole('button', { name: '保存' })).toBeDisabled()
  // 侧边栏「今天」的计数按纽约的日期重新请求
  await waitFor(() => expect(dueTo()).toContain('2026-11-03'))
})

test('也能按 UTC 偏移搜时区', async () => {
  setup()
  renderApp('/settings')
  const user = userEvent.setup()
  const profile = await section('个人资料')

  await user.click(timezonePicker(profile))
  await user.type(screen.getByPlaceholderText(/搜索城市/), 'utc+9')
  const options = screen.getAllByRole('option').map((o) => o.textContent)
  expect(options).toContain('Asia/TokyoUTC+9')
  expect(options).not.toContain('Asia/ShanghaiUTC+8')
})

test('这台设备的时区和设置的不一样时，可以一键改用它', async () => {
  deviceIn('Europe/London')
  const api = setup()
  renderApp('/settings')
  const user = userEvent.setup()
  const profile = await section('个人资料')

  expect(within(profile).getByText(/这台设备所在的时区是 Europe\/London/)).toBeInTheDocument()
  await user.click(within(profile).getByRole('button', { name: '改用这个' }))
  expect(timezonePicker(profile)).toHaveTextContent('Europe/London')
  await user.click(within(profile).getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(api.callsTo('PATCH /api/v1/account').map((c) => c.body)).toEqual([
      { display_name: 'Alice', timezone: 'Europe/London' },
    ]),
  )
  // 一样了就不再提示
  await waitFor(() => expect(within(profile).queryByText(/这台设备所在的时区/)).toBeNull())
})

test('昵称太长时提示，不提交', async () => {
  const api = setup()
  renderApp('/settings')
  const user = userEvent.setup()
  const profile = await section('个人资料')

  await user.clear(within(profile).getByLabelText('昵称'))
  await user.click(within(profile).getByLabelText('昵称'))
  await user.paste('长'.repeat(101))
  await user.click(within(profile).getByRole('button', { name: '保存' }))
  expect(await within(profile).findByText('昵称不能超过 100 个字符')).toBeInTheDocument()
  expect(api.callsTo('PATCH /api/v1/account')).toEqual([])
})

test('修改密码：先检查输入；当前密码不对时提示；改好后清空并提示', async () => {
  const api = setup({
    'POST /api/v1/auth/change-password': failOnce(apiError(400, 'invalid_current_password')),
  })
  renderApp('/settings')
  const user = userEvent.setup()
  const form = await section('修改密码')
  const current = within(form).getByLabelText('当前密码')
  const fresh = within(form).getByLabelText('新密码至少 8 位')
  const submit = within(form).getByRole('button', { name: '修改密码' })

  await user.type(fresh, 'short')
  await user.click(submit)
  expect(await within(form).findByText('此项为必填')).toBeInTheDocument()
  expect(within(form).getByText('密码至少 8 位')).toBeInTheDocument()
  expect(api.callsTo('POST /api/v1/auth/change-password')).toEqual([])

  await user.type(current, 'wrong one')
  await user.clear(fresh)
  await user.type(fresh, 'fresh passphrase')
  await user.click(submit)
  expect(await within(form).findByText('当前密码不正确')).toBeInTheDocument()

  await user.clear(current)
  await user.type(current, 'correct horse battery{Enter}')
  expect(await screen.findByText('密码已修改，其他设备上的登录已退出')).toBeInTheDocument()
  expect(current).toHaveValue('')
  expect(fresh).toHaveValue('')
  expect(api.callsTo('POST /api/v1/auth/change-password').map((c) => c.body)).toEqual([
    { current_password: 'wrong one', new_password: 'fresh passphrase' },
    { current_password: 'correct horse battery', new_password: 'fresh passphrase' },
  ])
})

test('删除账户：输入密码确认；密码不对时提示；删除后回到登录页', async () => {
  const api = setup({
    'POST /api/v1/account/delete': failOnce(apiError(400, 'invalid_current_password')),
  })
  const { router } = renderApp('/settings')
  const user = userEvent.setup()
  const open = await screen.findByRole('button', { name: '删除账户…' })

  // 取消后再打开，密码框是空的
  await user.click(open)
  let dialog = await screen.findByRole('alertdialog', { name: '永久删除账户？' })
  await user.type(within(dialog).getByLabelText('密码'), 'abc')
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await user.click(open)
  dialog = await screen.findByRole('alertdialog', { name: '永久删除账户？' })
  expect(within(dialog).getByText(/alice@example.com 的所有项目、任务和标签/)).toBeInTheDocument()
  const password = within(dialog).getByLabelText('密码')
  expect(password).toHaveValue('')
  expect(password).toHaveFocus()

  await user.click(within(dialog).getByRole('button', { name: '永久删除' }))
  expect(await within(dialog).findByText('此项为必填')).toBeInTheDocument()

  await user.type(password, 'wrong{Enter}')
  expect(await within(dialog).findByText('当前密码不正确')).toBeInTheDocument()
  await user.clear(password)
  await user.type(password, 'correct horse battery{Enter}')

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument()
  expect(await screen.findByText('账户已删除')).toBeInTheDocument()
  expect(api.callsTo('POST /api/v1/account/delete').map((c) => c.body)).toEqual([
    { password: 'wrong' },
    { password: 'correct horse battery' },
  ])
})
