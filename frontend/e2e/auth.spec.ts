import { expect, test, type Page } from '@playwright/test'

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

  await expect(page.getByRole('heading', { name: '你好，小明' })).toBeVisible()
  await expect(page.getByText(`请验证你的邮箱 ${email}`)).toBeVisible()
  await snap(page, '03-home-unverified')

  const link = await waitForEmailLink(email, '验证你的邮箱')
  await page.goto(link)
  await expect(page.getByText('邮箱验证成功')).toBeVisible()
  await snap(page, '04-verified')
  await page.getByRole('link', { name: '进入应用' }).click()
  await expect(page.getByRole('heading', { name: '你好，小明' })).toBeVisible()
  await expect(page.getByText(/请验证你的邮箱/)).toBeHidden()

  await page.getByRole('button', { name: '退出登录' }).click()
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
  await expect(page.getByRole('heading', { name: '你好，小明' })).toBeVisible()
})

test('忘记密码 → 邮件重置 → 用新密码登录', async ({ page }) => {
  const email = uniqueEmail('reset')
  const newPassword = 'a brand new passphrase'

  // 直接调接口注册，然后清掉 Cookie，模拟一个忘记密码的老用户
  const res = await page.request.post('/api/v1/auth/register', {
    data: { email, password: PASSWORD },
    headers: { Origin: 'http://localhost:5173' },
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
  await expect(page.getByRole('heading', { name: /^你好，/ })).toBeVisible()
})

test('手机尺寸下的登录页', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  await snap(page, '08-login-mobile')
})
