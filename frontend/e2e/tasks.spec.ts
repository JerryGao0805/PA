import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'

import { WEB_URL } from './env.ts'

const PASSWORD = 'correct horse battery'

/**
 * 设置了 E2E_SCREENSHOT_DIR 时截图。默认等打开面板之类的动画播完再截；
 * settle: false 时不等（拖拽中的截图：那时的过渡动画就是要看的）
 */
async function snap(page: Page, name: string, { settle = true } = {}) {
  const dir = process.env.E2E_SCREENSHOT_DIR
  if (!dir) return
  if (settle) {
    // 等动画放完（一直循环的，例如加载中的骨架屏，不等）。
    // 在浏览器里执行；e2e 的 tsconfig 没有 DOM 类型，所以写成字符串
    await page.waitForFunction(
      `document.getAnimations().every(
        (a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity,
      )`,
    )
  }
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
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

/** 以当前登录的用户调接口创建数据（项目、任务、标签），返回创建结果 */
async function create(
  page: Page,
  path: '/api/v1/projects' | '/api/v1/tasks' | '/api/v1/labels',
  data: object,
) {
  const res = await page.request.post(path, { data, headers: { Origin: WEB_URL } })
  expect(res.status()).toBe(201)
  return (await res.json()) as { id: string }
}

const taskTitles = (page: Page) => page.getByRole('main').getByRole('listitem').getByRole('link')
/** 主内容区里包含这段文字的一项（列表的一行，或看板上的一张卡片） */
const mainItem = (page: Page, text: string) =>
  page.getByRole('main').getByRole('listitem').filter({ hasText: text })
const sidebarItem = (page: Page, name: string) =>
  page.locator('[data-sidebar="menu-item"]').filter({ has: page.getByRole('link', { name }) })
/** 看板的一列，以及列里的任务标题 */
const boardColumn = (page: Page, name: string) =>
  page.getByRole('region', { name: new RegExp(`^${name}`) })
const columnTitles = (page: Page, name: string) =>
  boardColumn(page, name).getByRole('listitem').getByRole('link')

interface Point {
  x: number
  y: number
}
const center = (box: { x: number; y: number; width: number; height: number }): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
})

/**
 * 手机：支持触摸的浏览器上下文。触摸手势通过 Chrome DevTools 协议直接发送：
 * touch 发一个触摸事件；longPressDrag 先长按 400ms（超过 TouchSensor 的 250ms 延迟），
 * 再分步移到目标点松开
 */
async function mobilePage(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', { x, y }: Point) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  const longPressDrag = async (from: Point, to: Point, steps = 10) => {
    await touch('touchStart', from)
    await page.waitForTimeout(400)
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await touch('touchMove', { x, y })
    }
    await touch('touchEnd', to)
  }
  return { context, page, touch, longPressDrag }
}

/** 用鼠标把 source 拖到 target 的位置：先移动超过 5px 的激活距离，再分步移到目标中间 */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  beforeDrop?: () => Promise<void>,
) {
  const from = (await source.boundingBox())!
  const to = (await target.boundingBox())!
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await beforeDrop?.()
  await page.mouse.up()
  // 松手后 50ms 内 dnd-kit 会拦下所有 click（防止松手时误触），真人不会点得这么快；
  // 测试里紧接着点别的按钮会被吞掉，所以等它过去
  await page.waitForTimeout(60)
}

test('任务：添加 → 完成 → 新建项目 → 移动 → 删除并撤销，刷新后都还在', async ({ page }) => {
  await signUp(page, 'tasks')
  await page.goto('/')
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()
  await expect(page.getByText('收件箱是空的')).toBeVisible()

  // 连续添加三个任务
  await page.getByRole('button', { name: '添加任务' }).click()
  const input = page.getByRole('combobox', { name: '任务名称' })
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

test('计划：在详情里设置截止日期、优先级、标签和描述，出现在「今天」里，刷新后都还在', async ({
  page,
}) => {
  await signUp(page, 'plan')
  await page.goto('/inbox')
  await page.getByRole('button', { name: '添加任务' }).click()
  await page.getByRole('combobox', { name: '任务名称' }).fill('交报告')
  await page.getByRole('combobox', { name: '任务名称' }).press('Enter')
  await expect(page.getByRole('checkbox', { name: '完成「交报告」' })).toBeEnabled()
  await page.getByRole('combobox', { name: '任务名称' }).press('Escape')

  // 点标题打开详情，URL 上带 ?task=
  await taskTitles(page).filter({ hasText: '交报告' }).click()
  await expect(page).toHaveURL(/\/inbox\?task=[0-9a-f-]+$/)
  const panel = page.getByRole('dialog', { name: '任务详情' })
  await expect(panel.getByRole('textbox', { name: '任务名称' })).toHaveValue('交报告')

  // 截止日期：今天
  await panel.getByRole('button', { name: '添加日期' }).click()
  const popover = page.locator('[data-slot="popover-content"]')
  await popover.evaluate((el) =>
    Promise.all(el.getAnimations().map((a: { finished: Promise<unknown> }) => a.finished)),
  )
  await snap(page, '15-due-picker')
  await popover.getByRole('button', { name: /^今天/ }).first().click()
  await expect(panel.getByRole('button', { name: '今天', exact: true })).toBeVisible()

  // 优先级 1
  await panel.getByRole('button', { name: '优先级 4' }).click()
  await page.getByRole('menuitemradio', { name: '优先级 1' }).click()
  await expect(panel.getByRole('button', { name: '优先级 1' })).toBeVisible()

  // 新建并添加标签
  await panel.getByRole('button', { name: '添加标签' }).click()
  await page.getByPlaceholder('搜索或创建标签').fill('工作')
  await page.getByRole('option', { name: '创建标签「工作」' }).click()
  await expect(panel.getByRole('button', { name: '移除标签「工作」' })).toBeVisible()
  await page.keyboard.press('Escape')

  // 描述（Markdown）
  await panel.getByRole('button', { name: '添加描述…' }).click()
  await panel.getByRole('textbox', { name: '描述' }).fill('**重点**：周五前交')
  await panel.getByRole('textbox', { name: '任务名称' }).click()
  await expect(panel.locator('strong', { hasText: '重点' })).toBeVisible()
  await snap(page, '15-task-detail')

  await panel.getByRole('button', { name: '关闭' }).click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(sidebarItem(page, '今天')).toContainText('1')

  // 「今天」里有它，刷新后也还在
  await page.getByRole('link', { name: '今天', exact: true }).click()
  await expect(page.getByRole('heading', { name: '今天', level: 1 })).toBeVisible()
  await page.reload()
  const row = mainItem(page, '交报告')
  await expect(row).toContainText('今天')
  await expect(row).toContainText('工作')
  await expect(row).toContainText('收件箱')
  await expect(sidebarItem(page, '工作')).toBeVisible()
  await snap(page, '16-today')

  // 直接打开带 ?task= 的地址
  await row.getByRole('link').click()
  await page.reload()
  await expect(panel.locator('strong', { hasText: '重点' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '优先级 1' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // 在「今天」里完成
  await page.getByRole('checkbox', { name: '完成「交报告」' }).click()
  await expect(taskTitles(page)).toHaveCount(0)
  await expect(page.getByText('今天没有安排任务。')).toBeVisible()

  await page.getByRole('link', { name: '即将到来' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(7)
  await snap(page, '17-upcoming')
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

  // 详情面板在手机上占满整个屏幕宽度
  await page.getByRole('button', { name: '添加任务' }).click()
  await page.getByRole('combobox', { name: '任务名称' }).fill('手机上加的任务')
  await page.getByRole('combobox', { name: '任务名称' }).press('Enter')
  await expect(page.getByRole('checkbox', { name: '完成「手机上加的任务」' })).toBeEnabled()
  await taskTitles(page).filter({ hasText: '手机上加的任务' }).click()
  const panel = page.getByRole('dialog', { name: '任务详情' })
  await expect(panel).toBeVisible()
  // 等滑入动画结束再量宽度
  await panel.evaluate((el) =>
    Promise.all(el.getAnimations().map((a: { finished: Promise<unknown> }) => a.finished)),
  )
  const box = (await panel.boundingBox())!
  expect(box.width).toBeCloseTo(390, 0)
  await snap(page, '18-mobile-detail')
  await panel.getByRole('button', { name: '关闭' }).click()
  await expect(panel).toBeHidden()
})

test('子任务和拖拽排序：拖动任务、子任务和项目，刷新后顺序不变', async ({ page }) => {
  await signUp(page, 'sort')
  for (const name of ['工作', '生活']) await create(page, '/api/v1/projects', { name })
  await page.goto('/inbox')

  await page.getByRole('button', { name: '添加任务' }).click()
  const input = page.getByRole('combobox', { name: '任务名称' })
  for (const title of ['写周报', '买菜', '健身']) {
    await input.fill(title)
    await input.press('Enter')
    await expect(page.getByRole('checkbox', { name: `完成「${title}」` })).toBeEnabled()
  }
  await input.press('Escape')

  // 把「健身」拖到最前面
  const row = (title: string) => mainItem(page, title)
  await drag(page, row('健身'), row('写周报'), () => snap(page, '19-dragging', { settle: false }))
  await expect(taskTitles(page)).toHaveText(['健身', '写周报', '买菜'])
  // 松手时的那次 click 被拦下了：没有打开详情，也没有整页跳转
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 单击仍然是打开详情；在详情里添加子任务并拖动
  await taskTitles(page).filter({ hasText: '写周报' }).click()
  const panel = page.getByRole('dialog', { name: '任务详情' })
  await panel.getByRole('button', { name: '添加子任务' }).click()
  const subInput = panel.getByRole('combobox', { name: '子任务名称' })
  for (const title of ['列提纲', '写初稿', '发给老板']) {
    await subInput.fill(title)
    await subInput.press('Enter')
    await expect(panel.getByRole('checkbox', { name: `完成「${title}」` })).toBeEnabled()
  }
  await subInput.press('Escape')
  await expect(panel).toBeVisible()
  const subtasks = panel.getByRole('region', { name: /子任务/ }).getByRole('listitem')
  await drag(page, subtasks.filter({ hasText: '发给老板' }), subtasks.filter({ hasText: '列提纲' }))
  await expect(subtasks.getByRole('link')).toHaveText(['发给老板', '列提纲', '写初稿'])
  await expect(panel).toBeVisible()
  await snap(page, '20-subtasks')

  // 完成父任务：子任务一起完成。面板开着的时候也能点 toast 里的「撤销」
  await panel.getByRole('checkbox', { name: '完成「写周报」' }).click()
  await expect(panel.getByLabel('已完成 3 个子任务，共 3 个')).toBeVisible()
  await page
    .locator('[data-sonner-toast]')
    .filter({ hasText: '已完成「写周报」' })
    .getByRole('button', { name: '撤销' })
    .click()
  await expect(panel).toBeVisible()
  await expect(subtasks.getByRole('link')).toHaveText(['发给老板', '列提纲', '写初稿'])
  await panel.getByRole('button', { name: '关闭' }).click()
  await expect(panel).toBeHidden()
  await expect(row('写周报')).toContainText('0/3')
  await snap(page, '21-subtask-progress')

  // 侧边栏：把「生活」拖到「工作」前面
  const projects = page
    .locator('[data-sidebar="menu"]')
    .filter({ has: page.getByRole('link', { name: '工作' }) })
  await drag(page, sidebarItem(page, '生活'), sidebarItem(page, '工作'))
  await expect(projects.getByRole('link')).toHaveText(['生活', '工作'])
  await expect(page).toHaveURL(/\/inbox$/)

  // 刷新后顺序都还在
  await page.reload()
  await expect(taskTitles(page)).toHaveText(['健身', '写周报', '买菜'])
  await expect(projects.getByRole('link')).toHaveText(['生活', '工作'])
  await taskTitles(page).filter({ hasText: '写周报' }).click()
  await expect(subtasks.getByRole('link')).toHaveText(['发给老板', '列提纲', '写初稿'])

  // 打开子任务的详情，可以回到父任务
  await subtasks.getByRole('link', { name: '列提纲' }).click()
  await expect(panel.getByRole('textbox', { name: '任务名称' })).toHaveValue('列提纲')
  await snap(page, '22-subtask-detail')
  await panel.getByRole('link', { name: /写周报/ }).click()
  await expect(panel.getByRole('textbox', { name: '任务名称' })).toHaveValue('写周报')
})

test('手机：长按任务后拖动排序，轻点仍然是打开详情', async ({ browser }) => {
  const { context, page, touch, longPressDrag } = await mobilePage(browser)
  await signUp(page, 'touch')
  for (const title of ['第一件事', '第二件事', '第三件事']) {
    await create(page, '/api/v1/tasks', { title })
  }
  await page.goto('/inbox')
  await expect(taskTitles(page)).toHaveText(['第一件事', '第二件事', '第三件事'])

  const row = (title: string) => mainItem(page, title)
  await longPressDrag(
    center((await row('第三件事').boundingBox())!),
    center((await row('第一件事').boundingBox())!),
  )
  await expect(taskTitles(page)).toHaveText(['第三件事', '第一件事', '第二件事'])
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 没有长按就移动手指：是滚动，不会开始拖拽
  const second = center((await row('第二件事').boundingBox())!)
  const above = { x: second.x, y: second.y - 80 }
  await touch('touchStart', second)
  await touch('touchMove', above)
  await touch('touchEnd', above)
  await expect(taskTitles(page)).toHaveText(['第三件事', '第一件事', '第二件事'])

  // 轻点打开详情
  await row('第一件事').getByRole('link').tap()
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible()

  // 重新打开页面（不带 ?task=），顺序还在
  await page.goto('/inbox')
  await expect(taskTitles(page)).toHaveText(['第三件事', '第一件事', '第二件事'])
  await context.close()
})

test('看板：拖到「进行中」「已完成」再拖回来，刷新后都还在，列表里是同一个顺序', async ({
  page,
}) => {
  await signUp(page, 'board')
  const project = await create(page, '/api/v1/projects', { name: '发布新版本' })
  for (const title of ['写接口', '画设计稿', '联调', '写文档']) {
    await create(page, '/api/v1/tasks', { title, project_id: project.id })
  }
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('button', { name: '看板' }).click()
  await expect(page.getByRole('button', { name: '看板' })).toHaveAttribute('aria-pressed', 'true')

  const column = (name: string) => boardColumn(page, name)
  const titles = (name: string) => columnTitles(page, name)
  const card = (title: string) => mainItem(page, title)
  await expect(titles('待办')).toHaveText(['写接口', '画设计稿', '联调', '写文档'])
  await snap(page, '30-board')

  // 拖到空的「进行中」；松手后没有打开详情
  await drag(page, card('画设计稿'), column('进行中'), () =>
    snap(page, '31-board-dragging', { settle: false }),
  )
  await expect(titles('进行中')).toHaveText(['画设计稿'])
  await expect(titles('待办')).toHaveText(['写接口', '联调', '写文档'])
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 拖到「画设计稿」的上面
  await drag(page, card('写文档'), card('画设计稿'))
  await expect(titles('进行中')).toHaveText(['写文档', '画设计稿'])

  // 拖到「已完成」等于勾选完成
  await drag(page, card('联调'), column('已完成'))
  await expect(titles('已完成')).toHaveText(['联调'])
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '已完成「联调」' }),
  ).toBeVisible()

  // 刷新后还是看板，各列不变
  await page.reload()
  await expect(titles('待办')).toHaveText(['写接口'])
  await expect(titles('进行中')).toHaveText(['写文档', '画设计稿'])
  await expect(titles('已完成')).toHaveText(['联调'])
  await snap(page, '32-board-moved')

  // 经过「已完成」后拖到看板下面的空白处松手：取消，什么都不变
  const from = center((await card('写接口').boundingBox())!)
  const over = center((await column('已完成').boundingBox())!)
  const outside = { x: over.x, y: page.viewportSize()!.height - 20 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 10, { steps: 4 })
  await page.mouse.move(over.x, over.y, { steps: 12 })
  await expect(titles('已完成')).toHaveText(['写接口', '联调'])
  await page.mouse.move(outside.x, outside.y, { steps: 12 })
  // 离开看板时就放回原处，表示松手会取消
  await expect(titles('待办')).toHaveText(['写接口'])
  await page.mouse.up()
  await page.waitForTimeout(60)
  await expect(titles('待办')).toHaveText(['写接口'])
  await expect(titles('已完成')).toHaveText(['联调'])
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '写接口' })).toHaveCount(0)

  // 在「进行中」一列里直接添加
  await column('进行中').getByRole('button', { name: '添加任务' }).click()
  const input = column('进行中').getByRole('combobox', { name: '任务名称' })
  await input.fill('修 bug')
  await snap(page, '36-board-add')
  await input.press('Enter')
  await expect(titles('进行中')).toHaveText(['写文档', '画设计稿', '修 bug'])
  await input.press('Escape')

  // 详情里显示状态
  await card('画设计稿').getByRole('link').click()
  const panel = page.getByRole('dialog', { name: '任务详情' })
  await expect(panel.getByRole('button', { name: '进行中' })).toBeVisible()
  await snap(page, '37-detail-status')
  await panel.getByRole('button', { name: '关闭' }).click()

  // 从「已完成」拖回「待办」，放在「写接口」下面
  await drag(page, card('联调'), column('待办'))
  await expect(titles('待办')).toHaveText(['写接口', '联调'])
  await expect(titles('已完成')).toHaveCount(0)

  // 切回列表：看板上换列没有打乱原来的顺序（只有被拖到「画设计稿」上面的「写文档」挪了位置），
  // 进行中的任务带着标记
  await page.getByRole('button', { name: '列表' }).click()
  await expect(page.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true')
  await expect(taskTitles(page)).toHaveText(['写接口', '写文档', '画设计稿', '联调', '修 bug'])
  await expect(card('画设计稿')).toContainText('进行中')
  await expect(card('联调')).not.toContainText('进行中')
  await snap(page, '33-list-with-status')
})

test('手机：看板横向滑动，长按卡片拖到下一列', async ({ browser }) => {
  const { context, page, touch, longPressDrag } = await mobilePage(browser)
  await signUp(page, 'board-touch')
  const inbox = ((await (await page.request.get('/api/v1/projects')).json()) as { id: string }[])[0]
  const switched = await page.request.patch(`/api/v1/projects/${inbox.id}`, {
    data: { layout: 'board' },
    headers: { Origin: WEB_URL },
  })
  expect(switched.status()).toBe(200)
  for (const title of ['回邮件', '订机票']) await create(page, '/api/v1/tasks', { title })
  await page.goto('/inbox')
  const column = (name: string) => boardColumn(page, name)
  const titles = (name: string) => columnTitles(page, name)
  await expect(titles('待办')).toHaveText(['回邮件', '订机票'])
  // 一屏只放得下一列，下一列露出一点边
  const next = (await column('进行中').boundingBox())!
  expect(next.x).toBeGreaterThan(300)
  expect(next.x).toBeLessThan(390)
  await snap(page, '34-board-mobile')

  // 长按「订机票」，拖到右边露出来的「进行中」
  const from = center(
    (await column('待办').getByRole('listitem').filter({ hasText: '订机票' }).boundingBox())!,
  )
  await longPressDrag(from, { x: 380, y: next.y + 60 }, 12)
  await expect(titles('进行中')).toHaveText(['订机票'])
  await expect(titles('待办')).toHaveText(['回邮件'])

  // 手指横向滑动（没有长按）是滚动看板：停在下一列的开头
  const board = page.locator('[data-wide]')
  const y = from.y
  await touch('touchStart', { x: 300, y })
  for (let x = 280; x >= 60; x -= 20) await touch('touchMove', { x, y })
  await touch('touchEnd', { x: 60, y })
  await expect.poll(() => board.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200)
  // 吸附：这一列的开头对齐页面左边距（16px）
  await expect.poll(async () => Math.round((await column('进行中').boundingBox())!.x)).toBe(16)
  await snap(page, '35-board-mobile-scrolled')
  await context.close()
})

test('快速添加：按 Q，一句话写日期、项目、标签和优先级', async ({ page }) => {
  await signUp(page, 'quick-add')
  const project = await create(page, '/api/v1/projects', { name: '工作' })
  await create(page, '/api/v1/labels', { name: '重要' })
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible()

  await page.keyboard.press('q')
  const dialog = page.getByRole('dialog', { name: '快速添加任务' })
  const field = dialog.getByRole('combobox', { name: '任务名称' })
  await expect(field).toBeFocused()
  await field.pressSequentially('明天下午3点 交报告 #工')
  // 候选列表：回车选中
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['工作'])
  await snap(page, '40-quick-add-suggest')
  await page.keyboard.press('Enter')
  await field.pressSequentially('@重要 !p1')
  await expect(dialog.getByRole('list', { name: '识别出的内容' }).getByRole('listitem')).toHaveText(
    ['明天 15:00', '工作', '重要', '优先级 1'],
  )
  await expect(dialog.getByText('添加到')).toHaveText('添加到工作')
  await snap(page, '41-quick-add')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '已添加到「工作」' }),
  ).toBeVisible()

  // 列表里的「添加任务」也能识别；取消识别的部分留在名称里
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('button', { name: '添加任务' }).click()
  const input = page.getByRole('main').getByRole('combobox', { name: '任务名称' })
  await input.pressSequentially('周五 读完《三体》')
  await page.getByRole('button', { name: '取消识别「周五」' }).click()
  await input.press('Enter')
  await input.press('Escape')

  // 刷新后都在：带着日期、标签
  await page.reload()
  await expect(taskTitles(page)).toHaveText(['交报告', '周五 读完《三体》'])
  await expect(mainItem(page, '交报告')).toContainText('明天 15:00')
  await expect(mainItem(page, '交报告')).toContainText('重要')
  // 取消了识别：没有截止日期，这一行只有名称
  await expect(mainItem(page, '周五 读完《三体》')).toHaveText('周五 读完《三体》')
  await snap(page, '42-quick-add-result')
})
