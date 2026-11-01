import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { alice, apiError, empty, json, mockApi, renderApp, signedIn } from './render-app'

const ME = 'GET /api/v1/auth/me'

describe('路由守卫', () => {
  test('未登录访问首页会跳到登录页，并记住原地址', async () => {
    mockApi({ [ME]: apiError(401, 'not_authenticated') })
    const { router } = renderApp('/')

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  test('已登录访问登录页会直接进入应用', async () => {
    mockApi(signedIn())
    const { router } = renderApp('/login')

    expect(await screen.findByRole('heading', { name: '收件箱' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/inbox')
  })
})

describe('登录', () => {
  test('密码错误时显示错误提示', async () => {
    mockApi({
      [ME]: apiError(401, 'not_authenticated'),
      'POST /api/v1/auth/login': apiError(401, 'invalid_credentials'),
    })
    renderApp('/login')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'alice@example.com')
    await user.type(screen.getByLabelText('密码'), 'wrong password')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('邮箱或密码错误')).toBeInTheDocument()
  })

  test('登录成功后跳回原来要去的页面，并提示验证邮箱', async () => {
    const api = mockApi(
      signedIn({
        [ME]: apiError(401, 'not_authenticated'),
        'POST /api/v1/auth/login': json(alice),
      }),
    )
    const { router } = renderApp('/login?redirect=%2F')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'alice@example.com')
    await user.type(screen.getByLabelText('密码'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('heading', { name: '收件箱' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/inbox')
    expect(screen.getByText(/请验证你的邮箱 alice@example.com/)).toBeInTheDocument()
    expect(api.callsTo('POST /api/v1/auth/login')[0].body).toEqual({
      email: 'alice@example.com',
      password: 'correct horse battery',
    })
  })

  test('不会跳转到站外地址', async () => {
    mockApi(
      signedIn({
        [ME]: apiError(401, 'not_authenticated'),
        'POST /api/v1/auth/login': json(alice),
      }),
    )
    const { router } = renderApp('/login?redirect=https%3A%2F%2Fevil.example')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'alice@example.com')
    await user.type(screen.getByLabelText('密码'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await screen.findByRole('heading', { name: '收件箱' })
    expect(router.state.location.pathname).toBe('/inbox')
  })
})

describe('注册', () => {
  test('前端校验不通过时不发请求', async () => {
    const api = mockApi({ [ME]: apiError(401, 'not_authenticated') })
    renderApp('/register')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'not-an-email')
    await user.type(screen.getByLabelText(/^密码/), '123')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByText('请输入有效的邮箱地址')).toBeInTheDocument()
    expect(screen.getByText('密码至少 8 位')).toBeInTheDocument()
    expect(api.callsTo('POST /api/v1/auth/register')).toHaveLength(0)
  })

  test('注册时带上浏览器时区，成功后进入应用', async () => {
    const api = mockApi(
      signedIn({
        [ME]: apiError(401, 'not_authenticated'),
        'POST /api/v1/auth/register': json(alice, 201),
      }),
    )
    renderApp('/register')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'alice@example.com')
    await user.type(screen.getByLabelText(/^密码/), 'correct horse battery')
    await user.type(screen.getByLabelText(/^昵称/), 'Alice')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByRole('heading', { name: '收件箱' })).toBeInTheDocument()
    const body = api.callsTo('POST /api/v1/auth/register')[0].body as Record<string, string>
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  test('邮箱已注册时显示服务端错误', async () => {
    mockApi({
      [ME]: apiError(401, 'not_authenticated'),
      'POST /api/v1/auth/register': apiError(409, 'email_taken'),
    })
    renderApp('/register')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('邮箱'), 'alice@example.com')
    await user.type(screen.getByLabelText(/^密码/), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: '注册' }))

    expect(await screen.findByText('这个邮箱已经注册过了')).toBeInTheDocument()
  })
})

describe('邮件链接', () => {
  test('验证邮箱：从 URL 片段取 token 并只提交一次', async () => {
    const token = 'tok_abcdefghijklmnopqrstuvwxyz0123456789'
    const api = mockApi({
      [ME]: apiError(401, 'not_authenticated'),
      'POST /api/v1/auth/verify-email': json({ ...alice, email_verified: true }),
    })
    renderApp(`/verify-email#token=${token}`)

    expect(await screen.findByText('邮箱验证成功')).toBeInTheDocument()
    expect(api.callsTo('POST /api/v1/auth/verify-email')).toEqual([
      { key: 'POST /api/v1/auth/verify-email', body: { token } },
    ])
  })

  test('验证链接失效时给出提示', async () => {
    mockApi({
      [ME]: apiError(401, 'not_authenticated'),
      'POST /api/v1/auth/verify-email': apiError(400, 'invalid_token'),
    })
    renderApp('/verify-email#token=tok_abcdefghijklmnopqrstuvwxyz')
    expect(await screen.findByText('验证链接无效或已过期')).toBeInTheDocument()
  })

  test('重置密码链接缺少 token 时不显示表单', async () => {
    mockApi({ [ME]: apiError(401, 'not_authenticated') })
    renderApp('/reset-password')
    expect(await screen.findByText(/链接不完整/)).toBeInTheDocument()
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument()
  })

  test('重置密码成功后回到登录页', async () => {
    const token = 'tok_abcdefghijklmnopqrstuvwxyz0123456789'
    const api = mockApi({
      [ME]: apiError(401, 'not_authenticated'),
      'POST /api/v1/auth/reset-password': empty(),
    })
    const { router } = renderApp(`/reset-password#token=${token}`)
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('新密码'), 'a brand new passphrase')
    await user.click(screen.getByRole('button', { name: '保存新密码' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(api.callsTo('POST /api/v1/auth/reset-password')[0].body).toEqual({
      token,
      password: 'a brand new passphrase',
    })
  })
})

describe('会话', () => {
  test('退出登录后回到登录页', async () => {
    mockApi(signedIn({ 'POST /api/v1/auth/logout': empty() }))
    const { router } = renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '账号菜单' }))
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  test('操作时发现会话已失效（例如在别处改了密码），自动跳到登录页', async () => {
    mockApi(
      signedIn({ 'POST /api/v1/auth/resend-verification': apiError(401, 'not_authenticated') }),
    )
    const { router } = renderApp('/')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: '重新发送' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
