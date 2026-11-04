/** M2.3：子任务和拖拽排序 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  fakeBackend,
  inbox,
  keyboardDrag,
  makeProject,
  makeTask,
  mockApi,
  mockLayout,
  renderApp,
  signedIn,
  titlesIn,
} from './render-app'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T04:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const COMPLETED_AT = '2026-10-31T00:00:00Z'
const parent = makeTask({ id: 't-move', title: '搬家', sort_key: 'a0' })
const sub = (id: string, title: string, sortKey: string, extra = {}) =>
  makeTask({ id, title, parent_id: parent.id, sort_key: sortKey, ...extra })
const boxes = sub('t-boxes', '买纸箱', 'a0')
const movers = sub('t-movers', '订搬家公司', 'a1')
const keys = sub('t-keys', '交钥匙', 'a2', { status: 'done', completed_at: COMPLETED_AT })

function setup(tasks = [parent, boxes, movers, keys], projects = [inbox]) {
  const backend = fakeBackend({ projects, tasks })
  const api = mockApi(signedIn(backend.routes))
  return { api, backend }
}

// 详情面板打开时，Radix 会给面板外的内容加上 aria-hidden，按角色查找时要带上 hidden
const hidden = true
const findMain = async () => within(await screen.findByRole('main', { hidden }))
/** 详情面板里「子任务」这一块 */
const subtaskSection = (panel: HTMLElement) => within(panel).getByRole('region', { name: /子任务/ })
/** 子任务区里未完成的那个列表（已完成的收在下面，默认不展开） */
const openSubtasks = (panel: HTMLElement) => {
  const lists = within(subtaskSection(panel)).queryAllByRole('list')
  return lists.length ? titlesIn(lists[0]) : []
}

async function openDetail(title: string) {
  const user = userEvent.setup()
  await user.click(await (await findMain()).findByRole('link', { name: title }))
  return { user, panel: await screen.findByRole('dialog', { name: '任务详情' }) }
}

test('项目列表只显示顶层任务，父任务上显示子任务进度', async () => {
  setup()
  renderApp('/inbox')
  const main = await findMain()

  await waitFor(() => expect(titlesIn(main.getByRole('list', { hidden }))).toEqual(['搬家']))
  expect(main.getByText('已完成 1 个子任务，共 3 个')).toBeInTheDocument()
  expect(main.getByText('1/3')).toBeInTheDocument()
  // 侧边栏的计数也只算顶层任务
  const inboxItem = screen.getByRole('link', { name: /收件箱/ }).closest('li')!
  expect(within(inboxItem).getByText('1')).toBeInTheDocument()
})

test('在详情里添加子任务：立刻出现，父任务的进度跟着变', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const { user, panel } = await openDetail('搬家')

  await waitFor(() => expect(openSubtasks(panel)).toEqual(['买纸箱', '订搬家公司']))
  await user.click(within(panel).getByRole('button', { name: '添加子任务' }))
  await user.type(within(panel).getByRole('textbox', { name: '子任务名称' }), '打包{Enter}')

  expect(openSubtasks(panel)).toEqual(['买纸箱', '订搬家公司', '打包'])
  expect(within(panel).getByLabelText('已完成 1 个子任务，共 4 个')).toBeInTheDocument()
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '打包',
    project_id: inbox.id,
    parent_id: parent.id,
  })
  // 列表里的父任务也更新了
  expect((await findMain()).getByText('1/4')).toBeInTheDocument()

  // 完成一个子任务：移到下面的「已完成」里
  await user.click(within(panel).getByRole('checkbox', { name: '完成「买纸箱」' }))
  await waitFor(() => expect(openSubtasks(panel)).toEqual(['订搬家公司', '打包']))
  expect(within(panel).getByLabelText('已完成 2 个子任务，共 4 个')).toBeInTheDocument()
  expect(within(subtaskSection(panel)).getByRole('button', { name: /已完成\s*2/ })).toBeVisible()
})

test('完成父任务时子任务一起完成，撤销后恢复', async () => {
  const { backend } = setup()
  renderApp('/inbox')
  const { user, panel } = await openDetail('搬家')
  await waitFor(() => expect(openSubtasks(panel)).toHaveLength(2))

  await user.click(within(panel).getByRole('checkbox', { name: '完成「搬家」' }))

  await waitFor(() => expect(openSubtasks(panel)).toEqual([]))
  expect(within(panel).getByLabelText('已完成 3 个子任务，共 3 个')).toBeInTheDocument()
  // 已完成的任务不能再添加子任务
  expect(within(panel).queryByRole('button', { name: '添加子任务' })).not.toBeInTheDocument()
  await waitFor(() => expect(backend.task(boxes.id)?.status).toBe('done'))

  // 浏览器里 toast 可以点（index.css 里的 pointer-events: auto），jsdom 不加载样式表，
  // 这里跳过 user-event 的 pointer-events 检查；E2E 里在真实浏览器上验证
  const toast = (await screen.findByText('已完成「搬家」')).closest('li')!
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(within(toast).getByRole('button', { name: '撤销' }))
  // 面板没有被关掉
  expect(screen.getByRole('dialog', { name: '任务详情' })).toBeInTheDocument()

  // 只有和父任务一起完成的子任务重新打开，之前就完成的「交钥匙」不变
  await waitFor(() => expect(openSubtasks(panel)).toEqual(['买纸箱', '订搬家公司']))
  await waitFor(() => expect(backend.task(movers.id)?.status).toBe('todo'))
  expect(backend.task(keys.id)?.status).toBe('done')
})

test('子任务的详情里可以回到父任务；重新打开子任务时父任务也重新打开', async () => {
  const done = { status: 'done' as const, completed_at: COMPLETED_AT }
  const { backend } = setup([{ ...parent, ...done }, { ...keys }])
  renderApp(`/inbox?task=${keys.id}`)
  const user = userEvent.setup()
  const panel = await screen.findByRole('dialog', { name: '任务详情' })

  const back = await within(panel).findByRole('link', { name: /搬家/ })
  // 子任务没有下一层
  expect(within(panel).queryByRole('region', { name: /子任务/ })).not.toBeInTheDocument()

  await user.click(within(panel).getByRole('checkbox', { name: '重新打开「交钥匙」' }))
  await waitFor(() => expect(backend.task(parent.id)?.status).toBe('todo'))
  // 父任务回到了收件箱的列表里
  const main = await findMain()
  await waitFor(() => expect(titlesIn(main.getByRole('list', { hidden }))).toEqual(['搬家']))

  await user.click(back)
  await waitFor(() =>
    expect(within(panel).getByRole('textbox', { name: '任务名称' })).toHaveValue('搬家'),
  )
})

test('删除父任务：子任务一起从「今天」里消失，撤销后都回来', async () => {
  const today = sub('t-today', '订搬家公司', 'a0', { due_date: '2026-11-01' })
  setup([parent, today])
  renderApp('/inbox')
  const user = userEvent.setup()
  const todayBadge = () =>
    within(screen.getByRole('link', { name: /今天/ }).closest('li')!).queryByText(/^\d+$/)
  await waitFor(() => expect(todayBadge()).toHaveTextContent('1'))

  const main = await findMain()
  await user.click(main.getByRole('button', { name: '任务操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除' }))

  await waitFor(() => expect(todayBadge()).not.toBeInTheDocument())
  const toast = (await screen.findByText('已删除「搬家」')).closest('li')!
  await user.click(within(toast).getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(todayBadge()).toHaveTextContent('1'))
})

test('用键盘拖拽排序：空格拿起，方向键移动，空格放下', async () => {
  mockLayout()
  const tasks = ['a', 'b', 'c'].map((title, i) =>
    makeTask({ id: `t-${title}`, title, sort_key: `a${i}` }),
  )
  const { api, backend } = setup(tasks)
  renderApp('/inbox')
  const main = await findMain()

  await keyboardDrag(await main.findByRole('link', { name: 'a' }), ['ArrowDown'])

  await waitFor(() => expect(titlesIn(main.getByRole('list', { hidden }))).toEqual(['b', 'a', 'c']))
  expect(api.callsTo('POST /api/v1/tasks/t-a/move')[0].body).toEqual({ after_id: 't-b' })
  // 服务端给的新 key 也在 b 和 c 之间
  await waitFor(() => {
    const key = backend.task('t-a')!.sort_key
    expect(key > 'a1' && key < 'a2').toBe(true)
  })
  // 拖拽过程中焦点一直在原来的任务上，回车仍然是打开详情
  expect(main.getByRole('link', { name: 'a' })).toHaveFocus()
})

test('侧边栏的项目可以用键盘拖拽排序', async () => {
  mockLayout()
  const projects = ['工作', '生活', '学习'].map((name, i) => makeProject({ id: `p-${i}`, name }))
  const { api } = setup([], [inbox, ...projects])
  renderApp('/inbox')
  const sidebarNames = () =>
    within(screen.getByRole('link', { name: '工作' }).closest('ul')!)
      .getAllByRole('link')
      .map((a) => a.textContent)

  await keyboardDrag(await screen.findByRole('link', { name: '学习' }), ['ArrowUp', 'ArrowUp'])

  await waitFor(() => expect(sidebarNames()).toEqual(['学习', '工作', '生活']))
  expect(api.callsTo('POST /api/v1/projects/p-2/move')[0].body).toEqual({ after_id: null })
})
