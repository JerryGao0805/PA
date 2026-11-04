/** M4：快速添加（一句话里写日期、#项目、@标签、!优先级） */
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
  titlesIn,
} from './render-app'

// 用户时区（Asia/Shanghai）里是 2026-11-04 周三 14:00
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T06:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const work = makeProject({ id: 'p-work', name: '工作', color: 'blue' })
const life = makeProject({ id: 'p-life', name: '生活', color: 'green' })
const important = makeLabel({ id: 'l-important', name: '重要', color: 'red' })
const reading = makeLabel({ id: 'l-reading', name: '阅读', color: 'violet' })

function setup(tasks: ReturnType<typeof makeTask>[] = [], projects = [inbox, work, life]) {
  const backend = fakeBackend({
    projects,
    tasks,
    labels: [important, reading],
  })
  const api = mockApi(signedIn(backend.routes))
  return { api, backend }
}

const input = () => screen.getByRole('combobox', { name: '任务名称' })
const chips = () =>
  within(screen.getByRole('list', { name: '识别出的内容' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

async function openAddTask() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '添加任务' }))
  return user
}

test('一句话添加：识别出日期、项目、标签和优先级，名称里只留下剩下的', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '明天下午3点 交报告 #工作 @重要 !p1')

  expect(chips()).toEqual(['明天 15:00', '工作', '重要', '优先级 1'])
  // 识别出来的部分在输入框里高亮
  const highlighted = Array.from(input().parentElement!.querySelectorAll('mark'))
  expect(highlighted.map((m) => m.textContent)).toEqual(['明天下午3点', '#工作', '@重要', '!p1'])

  await user.keyboard('{Enter}')
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '交报告',
    project_id: work.id,
    due_date: '2026-11-05',
    due_time: '15:00:00',
    priority: 1,
    label_ids: [important.id],
  })
  // 加到了别的项目：收件箱里看不到，提示去了哪里
  expect(await screen.findByText('已添加到「工作」')).toBeInTheDocument()
  expect(input()).toHaveValue('')
  expect(screen.queryByRole('list', { name: '识别出的内容' })).toBeNull()
})

test('取消识别：那一段留在任务名称里', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '明天 交报告')
  expect(chips()).toEqual(['明天'])
  await user.click(screen.getByRole('button', { name: '取消识别「明天」' }))
  expect(screen.queryByRole('list', { name: '识别出的内容' })).toBeNull()

  // 接着输入也不会再识别这一段
  await user.type(input(), ' !p2')
  expect(chips()).toEqual(['优先级 2'])
  await user.click(screen.getByRole('button', { name: '添加' }))
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '明天 交报告',
    project_id: inbox.id,
    priority: 2,
  })
  await waitFor(() => expect(titlesIn(screen.getByRole('main'))).toEqual(['明天 交报告']))
})

test('输入 # 或 @ 时列出已有的项目、标签，可以用键盘选', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '写周报 #')
  const options = () =>
    within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
  expect(input()).toHaveAttribute('aria-expanded', 'true')
  expect(options()).toEqual(['收件箱', '工作', '生活'])

  // 接着输入时按名字筛选；方向键选，回车确认（不提交）
  await user.type(input(), '生')
  expect(options()).toEqual(['生活'])
  await user.keyboard('{Enter}')
  expect(input()).toHaveValue('写周报 #生活 ')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(api.callsTo('POST /api/v1/tasks')).toHaveLength(0)

  await user.type(input(), '@')
  expect(options()).toEqual(['重要', '阅读'])
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('option', { name: '阅读' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Tab}')
  expect(input()).toHaveValue('写周报 #生活 @阅读 ')
  expect(chips()).toEqual(['生活', '阅读'])

  // Esc 先关掉候选列表，再按一次才收起输入框
  await user.type(input(), '@')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(input()).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('combobox', { name: '任务名称' })).toBeNull()
})

test('关掉候选列表只对这一个 @ 有效', async () => {
  setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '@')
  await user.keyboard('{Escape}')
  // 接着输入也不再弹出
  await user.type(input(), '重')
  expect(screen.queryByRole('listbox')).toBeNull()

  // 提交以后，下一个任务里的 @ 照常弹出
  await user.type(input(), ' 写{Enter}')
  await user.type(input(), '@')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
})

test('名字输完整时回车直接提交，即使有更长的同名开头的项目排在前面', async () => {
  const weekly = makeProject({ id: 'p-weekly', name: '工作周报' })
  const { api } = setup([], [inbox, weekly, work, life])
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '写周报 #工作')
  const options = within(screen.getByRole('listbox')).getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['工作', '工作周报'])
  await user.keyboard('{Enter}')
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '写周报',
    project_id: work.id,
  })
})

test('光标在名字中间时选候选：光标后面那半个词一起换掉，不相干的字留着', async () => {
  setup()
  renderApp('/inbox')
  const user = await openAddTask()

  // #生|活
  await user.type(input(), '#生活{ArrowLeft}')
  expect(screen.getByRole('option', { name: '生活' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Enter}')
  expect(input()).toHaveValue('#生活 ')

  // 在「明天开会」前面插入 #工：后面的字不是项目名里的，不能吞掉
  await user.clear(input())
  await user.type(input(), '明天开会{Home}#工')
  await user.keyboard('{Enter}')
  expect(input()).toHaveValue('#工作 明天开会')
})

test('用鼠标点候选', async () => {
  setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), '#')
  await user.click(screen.getByRole('option', { name: '工作' }))
  expect(input()).toHaveValue('#工作 ')
  expect(input()).toHaveFocus()
})

test('按 Q 打开快速添加，默认加到当前页面的项目', async () => {
  const { api } = setup()
  renderApp(`/projects/${work.id}`)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '工作' })

  await user.keyboard('q')
  const dialog = await screen.findByRole('dialog', { name: '快速添加任务' })
  const field = within(dialog).getByRole('combobox', { name: '任务名称' })
  expect(field).toHaveFocus()
  expect(within(dialog).getByText('添加到').parentElement).toHaveTextContent('添加到工作')

  await user.type(field, '买牛奶 后天 #收件箱')
  expect(within(dialog).getByText('添加到').parentElement).toHaveTextContent('添加到收件箱')
  // 候选列表还开着，但名字已经输完整了：回车直接提交
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await user.keyboard('{Enter}')

  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '买牛奶',
    project_id: inbox.id,
    due_date: '2026-11-06',
    due_time: null,
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await screen.findByText('已添加到「收件箱」')).toBeInTheDocument()
})

test('在输入框里打 q 不会打开快速添加；侧边栏上的按钮也能打开', async () => {
  setup()
  renderApp('/inbox')
  const user = await openAddTask()

  await user.type(input(), 'quiz')
  expect(screen.queryByRole('dialog')).toBeNull()

  await user.click(screen.getByRole('button', { name: '快速添加' }))
  const dialog = await screen.findByRole('dialog', { name: '快速添加任务' })
  // 收件箱里打开：默认收件箱；Esc 关闭
  expect(within(dialog).getByText('添加到').parentElement).toHaveTextContent('添加到收件箱')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('别的弹窗开着时按 Q 不再叠一层快速添加', async () => {
  setup()
  renderApp(`/projects/${work.id}`)
  const user = userEvent.setup()

  const header = (await screen.findByRole('heading', { name: '工作' })).parentElement!
  await user.click(within(header).getByRole('button', { name: '项目操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除项目' }))
  const confirm = await screen.findByRole('alertdialog', { name: '删除「工作」？' })
  expect(confirm).toContainElement(document.activeElement as HTMLElement)

  await user.keyboard('q')
  expect(screen.queryByRole('dialog', { name: '快速添加任务' })).toBeNull()
})

test('「今天」里添加的默认今天到期，写了别的日期就用写的', async () => {
  const { api } = setup()
  renderApp('/today')
  const user = await openAddTask()

  await user.type(input(), '交电费 周五{Enter}')
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toMatchObject({
    title: '交电费',
    due_date: '2026-11-06',
  })
  await user.type(input(), '倒垃圾{Enter}')
  expect(api.callsTo('POST /api/v1/tasks')[1].body).toMatchObject({
    title: '倒垃圾',
    due_date: '2026-11-04',
  })
})

test('子任务不能用 # 指定项目', async () => {
  const { api } = setup([makeTask({ id: 't-move', title: '搬家', project_id: work.id })])
  renderApp(`/projects/${work.id}?task=t-move`)
  const user = userEvent.setup()
  const panel = await screen.findByRole('dialog', { name: '任务详情' })

  await user.click(within(panel).getByRole('button', { name: '添加子任务' }))
  const field = within(panel).getByRole('combobox', { name: '子任务名称' })
  await user.type(field, '#')
  expect(screen.queryByRole('listbox')).toBeNull()
  await user.type(field, '生活 打包 @重要{Enter}')

  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '#生活 打包',
    project_id: work.id,
    parent_id: 't-move',
    label_ids: [important.id],
  })
})
