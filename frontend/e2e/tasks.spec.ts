import { expect, test, type Page } from '@playwright/test'

import { WEB_URL } from './env.ts'

const PASSWORD = 'correct horse battery'

async function snap(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

/** 直接调接口注册一个新账号（当前页面随之处于登录状态） */
async function signUp(page: Page, tag: string) {
  const res = await page.request.post('/api/v1/auth/register', {
    data: {
      email: `e2e-${tag}-${Date.now()}@example.com`,
      password: PASSWORD,
      display_name: '小明',
    },
    headers: { Origin: WEB_URL },
  })
  expect(res.status()).toBe(201)
}

const taskTitles = (page: Page) => page.getByRole('main').getByRole('button', { name: /^编辑「/ })
const sidebarItem = (page: Page, name: string) =>
  page.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name }) })

test('任务：添加 → 完成 → 新建项目 → 移动 → 删除并撤销，刷新后都还在', async ({ page }) => {
  await signUp(page, 'tasks')
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByText('收件箱是空的')).toBeVisible()

  // 连续添加三个任务
  await page.getByRole('button', { name: '添加任务' }).click()
  const input = page.getByRole('textbox', { name: '任务名称' })
  for (const title of ['买牛奶', '写周报', '交电费']) {
    await input.fill(title)
    await input.press('Enter')
    await expect(page.getByRole('checkbox', { name: `完成「${title}」` })).toBeEnabled()
  }
  await input.press('Escape')
  await expect(sidebarItem(page, '收件箱')).toContainText('3')
  await snap(page, '10-inbox')

  await page.reload()
  await expect(taskTitles(page)).toHaveText(['买牛奶', '写周报', '交电费'])

  // 完成一个
  await page.getByRole('checkbox', { name: '完成「写周报」' }).click()
  await expect(page.getByText('已完成「写周报」')).toBeVisible()
  await expect(taskTitles(page)).toHaveText(['买牛奶', '交电费'])
  await page.getByRole('button', { name: /已完成\s*1/ }).click()
  await expect(page.getByRole('checkbox', { name: '重新打开「写周报」' })).toBeChecked()

  // 新建项目，创建后进入项目页
  await page.getByRole('button', { name: '新建项目' }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.getByLabel('名称').fill('工作')
  await dialog.getByRole('radio', { name: '蓝色', exact: true }).click()
  await snap(page, '11-new-project')
  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: '工作' })).toBeVisible()
  await expect(page.getByText('没有待办任务')).toBeVisible()

  // 回到收件箱，把「交电费」移到「工作」
  await page.getByRole('link', { name: '收件箱' }).click()
  const bill = page.getByRole('listitem').filter({ hasText: '交电费' })
  await bill.hover()
  await bill.getByRole('button', { name: '任务操作' }).click()
  await page.getByRole('menuitem', { name: '移动到' }).hover()
  await page.getByRole('menuitem', { name: '工作' }).click()
  await expect(taskTitles(page)).toHaveText(['买牛奶'])
  await expect(sidebarItem(page, '工作')).toContainText('1')

  // 删除后撤销
  const milk = page.getByRole('listitem').filter({ hasText: '买牛奶' })
  await milk.hover()
  await milk.getByRole('button', { name: '任务操作' }).click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await expect(taskTitles(page)).toHaveCount(0)
  await page
    .locator('[data-sonner-toast]')
    .filter({ hasText: '已删除「买牛奶」' })
    .getByRole('button', { name: '撤销' })
    .click()
  await expect(taskTitles(page)).toHaveText(['买牛奶'])

  // 刷新后所有改动都还在
  await page.reload()
  await expect(taskTitles(page)).toHaveText(['买牛奶'])
  await page.getByRole('link', { name: '工作' }).click()
  await expect(taskTitles(page)).toHaveText(['交电费'])
  await snap(page, '12-project')
})

test('手机尺寸：侧边栏是抽屉，点导航后自动收起', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page, 'mobile')
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByRole('link', { name: '收件箱' })).toBeHidden()
  await snap(page, '13-mobile-inbox')

  await page.getByRole('button', { name: '切换侧边栏' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('link', { name: '收件箱' })).toBeVisible()
  // 等滑出动画结束再截图
  await drawer.evaluate((el) =>
    Promise.all(el.getAnimations().map((a: { finished: Promise<unknown> }) => a.finished)),
  )
  await snap(page, '14-mobile-drawer')

  await drawer.getByRole('link', { name: '收件箱' }).click()
  await expect(drawer).toBeHidden()
})
