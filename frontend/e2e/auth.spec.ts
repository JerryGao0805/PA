import { expect, test, type Page } from '@playwright/test'

import { WEB_URL } from './env.ts'
import { waitForEmailLink } from './mailpit.ts'

const PASSWORD = 'correct horse battery'
const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}@example.com`

// 设置 E2E_SCREENSHOT_DIR 时保存关键页面截图，方便人工检查界面
async function snap(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('注册 → 验证邮箱 → 退出 → 重新登录', async ({ page }) => {
  const email = uniqueEmail('signup')

  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await snap(page, '01-login')

  await page.getByRole('link', { name: '注册' }).click()
  await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible()
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel(/^密码/).fill(PASSWORD)
  await page.getByLabel(/^昵称/).fill('小明')
  await snap(page, '02-register')
  await page.getByRole('button', { name: '注册' }).click()

  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByRole('button', { name: '账号菜单' })).toContainText('小明')
  await expect(page.getByText(`请验证你的邮箱 ${email}`)).toBeVisible()
  await snap(page, '03-home-unverified')

  const link = await waitForEmailLink(email, '验证你的邮箱')
  await page.goto(link)
  await expect(page.getByText('邮箱验证成功')).toBeVisible()
  await snap(page, '04-verified')
  await page.getByRole('link', { name: '进入应用' }).click()
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByText(/请验证你的邮箱/)).toBeHidden()

  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
  // 退出后回到受保护的页面会被拦下
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()

  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码', { exact: true }).fill('wrong password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('邮箱或密码错误')).toBeVisible()
  await snap(page, '05-login-error')

  await page.getByLabel('密码', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
})

test('忘记密码 → 邮件重置 → 用新密码登录', async ({ page }) => {
  const email = uniqueEmail('reset')
  const newPassword = 'a brand new passphrase'

  // 直接调接口注册，然后清掉 Cookie，模拟一个忘记密码的老用户
  const res = await page.request.post('/api/v1/auth/register', {
    data: { email, password: PASSWORD },
    headers: { Origin: WEB_URL },
  })
  expect(res.status()).toBe(201)
  await page.context().clearCookies()

  await page.goto('/login')
  await page.getByRole('link', { name: '忘记密码？' }).click()
  await expect(page.getByRole('heading', { name: '找回密码' })).toBeVisible()
  await page.getByLabel('邮箱').fill(email)
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByText('请查收邮件')).toBeVisible()
  await snap(page, '06-forgot-sent')

  const link = await waitForEmailLink(email, '重置密码')
  await page.goto(link)
  await page.getByLabel('新密码').fill(newPassword)
  await snap(page, '07-reset')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('密码已更新，请用新密码登录')).toBeVisible()

  // 同一个链接不能再用第二次
  await page.goto(link)
  await page.getByLabel('新密码').fill('yet another passphrase')
  await page.getByRole('button', { name: '保存新密码' }).click()
  await expect(page.getByText('链接无效或已过期')).toBeVisible()

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
})

test('设置：改昵称和时区 → 修改密码（其他设备退出）→ 删除账户', async ({ page, browser }) => {
  const email = uniqueEmail('settings')
  const newPassword = 'a brand new passphrase'
  const res = await page.request.post('/api/v1/auth/register', {
    data: { email, password: PASSWORD, display_name: '小明', timezone: 'Asia/Shanghai' },
    headers: { Origin: WEB_URL },
  })
  expect(res.status()).toBe(201)
  // 另一台设备也登录着
  const phone = await browser.newContext()
  const login = await phone.request.post(`${WEB_URL}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
    headers: { Origin: WEB_URL },
  })
  expect(login.status()).toBe(200)

  await page.goto('/inbox')
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: '设置' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()

  const profile = page.getByRole('region', { name: '个人资料' })
  const timezone = profile.getByRole('combobox', { name: '时区' })
  await expect(timezone).toContainText('Asia/ShanghaiUTC+8')
  await profile.getByLabel('昵称').fill('小明同学')
  await timezone.click()
  await page.getByPlaceholder(/搜索城市/).fill('new york')
  await snap(page, '09-settings-timezone')
  await page.getByRole('option', { name: /America\/New York/ }).click()
  await profile.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存')).toBeVisible()
  await expect(page.getByRole('button', { name: '账号菜单' })).toContainText('小明同学')
  // 刷新后还在
  await page.reload()
  await expect(timezone).toContainText('America/New York')
  await expect(profile.getByLabel('昵称')).toHaveValue('小明同学')
  await snap(page, '10-settings')

  const password = page.getByRole('region', { name: '修改密码' })
  await password.getByLabel('当前密码').fill(PASSWORD)
  await password.getByLabel(/^新密码/).fill(newPassword)
  await password.getByRole('button', { name: '修改密码' }).click()
  await expect(page.getByText('密码已修改，其他设备上的登录已退出')).toBeVisible()
  expect((await phone.request.get(`${WEB_URL}/api/v1/auth/me`)).status()).toBe(401)
  await phone.close()

  await page.getByRole('button', { name: '删除账户…' }).click()
  const dialog = page.getByRole('alertdialog', { name: '永久删除账户？' })
  // 旧密码已经不对了
  await dialog.getByLabel('密码', { exact: true }).fill(PASSWORD)
  await dialog.getByRole('button', { name: '永久删除' }).click()
  await expect(dialog.getByText('当前密码不正确')).toBeVisible()
  await dialog.getByLabel('密码', { exact: true }).fill(newPassword)
  await snap(page, '11-delete-account')
  await dialog.getByRole('button', { name: '永久删除' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('账户已删除')).toBeVisible()

  // 账户没了，登不上
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('邮箱或密码错误')).toBeVisible()
})

test('手机尺寸下的登录页', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  await snap(page, '08-login-mobile')
})
