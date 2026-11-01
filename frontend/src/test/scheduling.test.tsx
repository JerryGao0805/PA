/** M2.2：截止日期、优先级、标签、详情面板，以及「今天」「即将到来」和标签页 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  fakeBackend,
  inbox,
  makeLabel,
  makeProject,
  makeTask,
  mockApi,
  renderApp,
  signedIn,
} from './render-app'

// 只固定「现在」，定时器保持真实（user-event 和 Radix 的动画要用）。
// 2026-11-01T04:00Z 是上海时间（测试用户的时区）11 月 1 日周日中午
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T04:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

const TODAY = '2026-11-01'
const work = makeProject({ id: 'p-work', name: '工作', color: 'blue' })
const home = makeLabel({ id: 'l-home', name: '家', color: 'green' })

const main = () => within(screen.getByRole('main'))
/** 页面还在加载时 main 还不存在 */
const findMain = async () => within(await screen.findByRole('main'))
const titlesIn = (container: HTMLElement) =>
  within(container)
    .queryAllByRole('listitem')
    .map((li) => (within(li).queryByRole('link') ?? li).textContent)
const section = (name: string | RegExp) => main().getByRole('region', { name })
const sidebarBadge = (name: string) =>
  within(screen.getByRole('link', { name }).closest('li')!).queryByText(/^\d+$/)

function setup(tasks = [] as ReturnType<typeof makeTask>[]) {
  const backend = fakeBackend({ projects: [inbox, work], tasks, labels: [home] })
  const api = mockApi(signedIn(backend.routes))
  return { api, backend }
}

/** 打开某个任务的详情面板 */
async function openDetail(title: string) {
  const user = userEvent.setup()
  await user.click(await (await findMain()).findByRole('link', { name: title }))
  return { user, panel: await screen.findByRole('dialog', { name: '任务详情' }) }
}

async function closeDetail(user: ReturnType<typeof userEvent.setup>, panel: HTMLElement) {
  await user.click(within(panel).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

test('今天：逾期的在前，今天的按时间、优先级排序，并显示所属项目', async () => {
  setup([
    makeTask({ id: 't1', title: '全天 P4', due_date: TODAY }),
    makeTask({ id: 't2', title: '全天 P1', due_date: TODAY, priority: 1, project_id: work.id }),
    makeTask({ id: 't3', title: '上午九点', due_date: TODAY, due_time: '09:00:00' }),
    makeTask({ id: 't4', title: '上周的', due_date: '2026-10-25', project_id: work.id }),
    makeTask({ id: 't5', title: '明天的', due_date: '2026-11-02' }),
    makeTask({ id: 't6', title: '没有日期' }),
  ])
  renderApp('/today')

  expect(
    await (await findMain()).findByRole('heading', { name: '今天', level: 1 }),
  ).toBeInTheDocument()
  expect(main().getByText('11月1日 周日', { selector: 'p' })).toBeInTheDocument()
  expect(titlesIn(section(/已逾期/))).toEqual(['上周的'])
  expect(titlesIn(section(/11月1日 · 今天/))).toEqual(['上午九点', '全天 P1', '全天 P4'])

  // 逾期的显示具体日期，今天的显示时间；跨项目列表显示所属项目
  const overdue = within(section(/已逾期/)).getByRole('listitem')
  expect(overdue).toHaveTextContent('10月25日')
  expect(overdue).toHaveTextContent('工作')
  expect(within(section(/11月1日/)).getAllByRole('listitem')[0]).toHaveTextContent('今天 09:00')
  // 侧边栏的计数包括逾期的
  expect(sidebarBadge('今天')).toHaveTextContent('4')
})

test('今天：添加的任务默认今天到期、放进收件箱', async () => {
  const { api } = setup()
  renderApp('/today')
  const user = userEvent.setup()

  expect(await (await findMain()).findByText('今天没有安排任务。')).toBeInTheDocument()
  await user.click(main().getByRole('button', { name: '添加任务' }))
  await user.type(main().getByRole('textbox', { name: '任务名称' }), '交电费{Enter}')

  await waitFor(() => expect(titlesIn(screen.getByRole('main'))).toEqual(['交电费']))
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '交电费',
    project_id: inbox.id,
    due_date: TODAY,
  })
  await waitFor(() => expect(sidebarBadge('今天')).toHaveTextContent('1'))
})

test('在详情里把截止日期改到明天：移出「今天」，出现在「即将到来」的明天', async () => {
  const { api, backend } = setup([
    makeTask({ id: 't-report', title: '交报告', due_date: TODAY, due_time: '15:00:00' }),
  ])
  renderApp('/today')
  const { user, panel } = await openDetail('交报告')

  await user.click(within(panel).getByRole('button', { name: '今天 15:00' }))
  await user.click(await screen.findByRole('button', { name: /^明天/ }))

  // 换日期时保留原来的时间
  expect(api.callsTo('PATCH /api/v1/tasks/t-report')[0].body).toEqual({
    due_date: '2026-11-02',
    due_time: '15:00:00',
  })
  expect(await within(panel).findByRole('button', { name: '明天 15:00' })).toBeInTheDocument()
  await waitFor(() => expect(backend.task('t-report')?.due_date).toBe('2026-11-02'))

  await closeDetail(user, panel)
  expect(titlesIn(screen.getByRole('main'))).toEqual([])
  expect(sidebarBadge('今天')).toBeNull()

  await user.click(screen.getByRole('link', { name: '即将到来' }))
  expect(
    await (await findMain()).findByRole('heading', { name: '即将到来', level: 1 }),
  ).toBeInTheDocument()
  expect(titlesIn(section(/11月2日 · 明天/))).toEqual(['交报告'])
})

test('在详情里清除截止日期、设置具体时间', async () => {
  const { api } = setup([makeTask({ id: 't-a', title: '整理照片', due_date: '2026-11-04' })])
  renderApp('/inbox')
  const { user, panel } = await openDetail('整理照片')

  // 本周内的日期显示星期几
  await user.click(within(panel).getByRole('button', { name: '周三' }))
  const time = await screen.findByLabelText('时间')
  await user.type(time, '0930')
  await user.tab()
  await waitFor(() =>
    expect(api.callsTo('PATCH /api/v1/tasks/t-a').at(-1)?.body).toEqual({
      due_date: '2026-11-04',
      due_time: '09:30',
    }),
  )

  await user.click(screen.getByRole('button', { name: '无日期' }))
  expect(api.callsTo('PATCH /api/v1/tasks/t-a').at(-1)?.body).toEqual({
    due_date: null,
    due_time: null,
  })
  expect(await within(panel).findByRole('button', { name: '添加日期' })).toBeInTheDocument()
})

test('在详情里设置优先级和项目', async () => {
  const { api, backend } = setup([makeTask({ id: 't-a', title: '写周报' })])
  renderApp('/inbox')
  const { user, panel } = await openDetail('写周报')

  await user.click(within(panel).getByRole('button', { name: '优先级 4' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '优先级 1' }))
  expect(api.callsTo('PATCH /api/v1/tasks/t-a')[0].body).toEqual({ priority: 1 })
  expect(await within(panel).findByRole('button', { name: '优先级 1' })).toBeInTheDocument()

  await user.click(within(panel).getByRole('button', { name: '收件箱' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '工作' }))
  await waitFor(() => expect(backend.task('t-a')?.project_id).toBe(work.id))
  expect(within(panel).getByRole('button', { name: '工作' })).toBeInTheDocument()

  // 移走了，收件箱里不再有它
  await closeDetail(user, panel)
  expect(titlesIn(screen.getByRole('main'))).toEqual([])
})

test('在详情里添加已有标签、新建标签；标签名不能有空格', async () => {
  const { api, backend } = setup([makeTask({ id: 't-a', title: '修水管' })])
  renderApp('/inbox')
  const { user, panel } = await openDetail('修水管')

  await user.click(within(panel).getByRole('button', { name: '添加标签' }))
  await user.click(await screen.findByRole('option', { name: '家' }))
  expect(api.callsTo('PATCH /api/v1/tasks/t-a')[0].body).toEqual({ label_ids: [home.id] })
  expect(within(panel).getByRole('button', { name: '移除标签「家」' })).toBeInTheDocument()

  const search = screen.getByPlaceholderText('搜索或创建标签')
  await user.type(search, '两个 词')
  expect(screen.getByRole('option', { name: '标签名不能包含空格' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await user.clear(search)
  await user.type(search, '急事')
  await user.click(screen.getByRole('option', { name: '创建标签「急事」' }))

  await waitFor(() => expect(api.callsTo('POST /api/v1/labels')).toHaveLength(1))
  expect(api.callsTo('POST /api/v1/labels')[0].body).toEqual({ name: '急事' })
  await waitFor(() => expect(backend.task('t-a')?.label_ids).toHaveLength(2))
  expect(within(panel).getByRole('button', { name: '移除标签「急事」' })).toBeInTheDocument()

  // 关掉面板后：列表里显示标签，侧边栏里有新标签
  await user.keyboard('{Escape}')
  await closeDetail(user, panel)
  const row = main().getByRole('listitem')
  expect(row).toHaveTextContent('家')
  expect(row).toHaveTextContent('急事')
  expect(screen.getByRole('link', { name: '急事' })).toBeInTheDocument()
})

test('描述：渲染 Markdown，编辑后离开文本框即保存', async () => {
  const { api } = setup([
    makeTask({ id: 't-a', title: '读书', description: '**重点** 见 [书单](https://example.com)' }),
    makeTask({ id: 't-b', title: '空描述' }),
  ])
  renderApp('/inbox')
  let { user, panel } = await openDetail('读书')

  expect(within(panel).getByText('重点').tagName).toBe('STRONG')
  const link = within(panel).getByRole('link', { name: '书单' })
  expect(link).toHaveAttribute('href', 'https://example.com')
  expect(link).toHaveAttribute('target', '_blank')
  await closeDetail(user, panel)
  ;({ user, panel } = await openDetail('空描述'))

  await user.click(within(panel).getByRole('button', { name: '添加描述…' }))
  await user.type(within(panel).getByRole('textbox', { name: '描述' }), '- 第一章')
  await user.click(within(panel).getByRole('textbox', { name: '任务名称' }))

  expect(api.callsTo('PATCH /api/v1/tasks/t-b')[0].body).toEqual({ description: '- 第一章' })
  expect(await within(panel).findByRole('listitem')).toHaveTextContent('第一章')
})

test('关闭面板时会保存正在编辑的描述', async () => {
  const { api } = setup([makeTask({ id: 't-a', title: '读书' })])
  renderApp('/inbox')
  const { user, panel } = await openDetail('读书')

  await user.click(within(panel).getByRole('button', { name: '添加描述…' }))
  await user.type(within(panel).getByRole('textbox', { name: '描述' }), '还没写完')
  await closeDetail(user, panel)

  expect(api.callsTo('PATCH /api/v1/tasks/t-a').map((c) => c.body)).toEqual([
    { description: '还没写完' },
  ])
})

test('即将到来：未来 7 天按天分组，在某一天下面添加的任务就是那天到期', async () => {
  const { api } = setup([
    makeTask({ id: 't1', title: '周三的', due_date: '2026-11-04' }),
    makeTask({ id: 't2', title: '第八天', due_date: '2026-11-08' }),
  ])
  renderApp('/upcoming')
  const user = userEvent.setup()

  await (await findMain()).findByRole('heading', { name: '即将到来', level: 1 })
  expect(
    main()
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.replace(/\d+$/, '')),
  ).toEqual([
    '11月1日 · 今天',
    '11月2日 · 明天',
    '11月3日 · 周二',
    '11月4日 · 周三',
    '11月5日 · 周四',
    '11月6日 · 周五',
    '11月7日 · 周六',
  ])
  expect(titlesIn(section(/11月4日/))).toEqual(['周三的'])

  const tuesday = section(/11月3日/)
  await user.click(within(tuesday).getByRole('button', { name: '添加任务' }))
  await user.type(within(tuesday).getByRole('textbox', { name: '任务名称' }), '取快递{Enter}')
  await waitFor(() => expect(titlesIn(tuesday)).toEqual(['取快递']))
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toMatchObject({ due_date: '2026-11-03' })
})

test('完成「今天」里的任务：移出列表，侧边栏计数减一', async () => {
  setup([
    makeTask({ id: 't1', title: '晨跑', due_date: TODAY }),
    makeTask({ id: 't2', title: '冥想', due_date: TODAY }),
  ])
  renderApp('/today')
  const user = userEvent.setup()

  await user.click(await (await findMain()).findByRole('checkbox', { name: '完成「晨跑」' }))
  await waitFor(() => expect(titlesIn(screen.getByRole('main'))).toEqual(['冥想']))
  expect(sidebarBadge('今天')).toHaveTextContent('1')
})

test('标签页：显示带这个标签的任务，可以在这里添加', async () => {
  const { api } = setup([
    makeTask({ id: 't1', title: '修水管', label_ids: [home.id], project_id: work.id }),
    makeTask({ id: 't2', title: '没标签' }),
  ])
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('link', { name: '家' }))
  expect(
    await (await findMain()).findByRole('heading', { name: '家', level: 1 }),
  ).toBeInTheDocument()
  expect(titlesIn(screen.getByRole('main'))).toEqual(['修水管'])

  await user.click(main().getByRole('button', { name: '添加任务' }))
  await user.type(main().getByRole('textbox', { name: '任务名称' }), '换灯泡{Enter}')
  await waitFor(() => expect(titlesIn(screen.getByRole('main'))).toEqual(['修水管', '换灯泡']))
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '换灯泡',
    project_id: inbox.id,
    label_ids: [home.id],
  })
})

test('新建标签后进入标签页；名字重复时提示', async () => {
  setup()
  const { router } = renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '新建标签' }))
  let dialog = await screen.findByRole('dialog', { name: '新建标签' })
  await user.type(within(dialog).getByLabelText('名称'), '有 空格')
  await user.click(within(dialog).getByRole('button', { name: '创建' }))
  expect(await within(dialog).findByText('标签名不能包含空格')).toBeInTheDocument()

  await user.clear(within(dialog).getByLabelText('名称'))
  await user.type(within(dialog).getByLabelText('名称'), '读书')
  await user.click(within(dialog).getByRole('radio', { name: '紫色' }))
  await user.click(within(dialog).getByRole('button', { name: '创建' }))

  expect(
    await (await findMain()).findByRole('heading', { name: '读书', level: 1 }),
  ).toBeInTheDocument()
  expect(router.state.location.pathname).toMatch(/^\/labels\//)

  mockApi(
    signedIn({
      'POST /api/v1/labels': () =>
        Response.json({ code: 'label_name_taken', message: '' }, { status: 409 }),
    }),
  )
  await user.click(screen.getByRole('button', { name: '新建标签' }))
  dialog = await screen.findByRole('dialog', { name: '新建标签' })
  await user.type(within(dialog).getByLabelText('名称'), '家')
  await user.click(within(dialog).getByRole('button', { name: '创建' }))
  expect(await screen.findByText('已经有同名的标签了')).toBeInTheDocument()
  // 失败时对话框不关闭，方便改名
  expect(screen.getByRole('dialog', { name: '新建标签' })).toBeInTheDocument()
})

test('删除正在查看的标签后回到收件箱，任务保留', async () => {
  const backend = fakeBackend({
    projects: [inbox],
    tasks: [makeTask({ id: 't1', title: '修水管', label_ids: [home.id] })],
    labels: [home],
  })
  const api = mockApi(signedIn(backend.routes))
  const { router } = renderApp('/labels/l-home')
  const user = userEvent.setup()

  const header = (await (await findMain()).findByRole('heading', { name: '家', level: 1 }))
    .parentElement!
  await user.click(within(header).getByRole('button', { name: '标签操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除标签' }))
  const dialog = await screen.findByRole('alertdialog', { name: '删除标签「家」？' })
  await user.click(within(dialog).getByRole('button', { name: '删除' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'))
  expect(api.callsTo('DELETE /api/v1/labels/l-home')).toHaveLength(1)
  expect(screen.queryByRole('link', { name: '家' })).not.toBeInTheDocument()
  // 任务还在，只是没有标签了
  await waitFor(() => expect(main().getByRole('listitem')).toHaveTextContent(/^修水管$/))
})

test('访问不存在的标签时给出提示', async () => {
  setup()
  renderApp('/labels/nope')
  expect(await screen.findByText('标签不存在，可能已被删除。')).toBeInTheDocument()
})

test('直接打开带 ?task= 的链接也能显示详情；任务不存在时给出提示', async () => {
  setup([makeTask({ id: 't-a', title: '写周报', priority: 2 })])
  renderApp('/inbox?task=t-a')
  const panel = await screen.findByRole('dialog', { name: '任务详情' })
  expect(within(panel).getByRole('textbox', { name: '任务名称' })).toHaveValue('写周报')
  expect(within(panel).getByRole('button', { name: '优先级 2' })).toBeInTheDocument()
})

test('详情：任务不存在时给出提示', async () => {
  setup()
  renderApp('/inbox?task=missing')
  const panel = await screen.findByRole('dialog', { name: '任务详情' })
  expect(await within(panel).findByText('任务不存在，可能已被删除。')).toBeInTheDocument()
})
