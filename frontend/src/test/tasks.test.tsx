import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  apiError,
  empty,
  fakeBackend,
  held,
  inbox,
  json,
  makeProject,
  makeTask,
  mockApi,
  renderApp,
  signedIn,
} from './render-app'

const milk = makeTask({ id: 't-milk', title: '买牛奶', sort_key: 'a0' })
const report = makeTask({ id: 't-report', title: '写周报', sort_key: 'a1' })
const work = makeProject({ id: 'p-work', name: '工作', color: 'blue' })
const planning = makeTask({ id: 't-plan', title: '季度计划', project_id: work.id })

/** 收件箱里有两个任务，另有一个「工作」项目（里面一个任务） */
function setup(routes = {}) {
  const backend = fakeBackend({ projects: [inbox, work], tasks: [milk, report, planning] })
  const api = mockApi(signedIn({ ...backend.routes, ...routes }))
  return { api, backend }
}

const inboxBadge = () =>
  within(screen.getByRole('link', { name: /收件箱/ }).closest('li')!).queryByText(/^\d+$/)
/** 某条 toast 里的「撤销」按钮 */
const undoIn = async (message: string) =>
  within((await screen.findByText(message)).closest('li')!).getByRole('button', { name: '撤销' })
const taskTitles = () =>
  screen.getAllByRole('button', { name: /^编辑/ }).map((button) => button.textContent)

test('首页进入收件箱：显示任务、项目和计数', async () => {
  setup()
  const { router } = renderApp('/')

  expect(await screen.findByRole('heading', { name: '收件箱' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/inbox')
  expect(taskTitles()).toEqual(['买牛奶', '写周报'])
  expect(inboxBadge()).toHaveTextContent('2')
  expect(screen.getByRole('link', { name: /工作/ })).toHaveAttribute('href', '/projects/p-work')
})

test('添加任务：请求返回前就显示在列表里，返回后可以操作', async () => {
  const backend = fakeBackend({ projects: [inbox], tasks: [] })
  const create = held(backend.routes['POST /api/v1/tasks'])
  const api = mockApi(signedIn({ ...backend.routes, 'POST /api/v1/tasks': create.handler }))
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '添加任务' }))
  await user.type(screen.getByRole('textbox', { name: '任务名称' }), '交电费{Enter}')

  // 乐观更新：服务端还没返回就出现在列表里、计数 +1，但确认前不能勾选
  const checkbox = await screen.findByRole('checkbox', { name: '完成「交电费」' })
  expect(checkbox).toBeDisabled()
  expect(inboxBadge()).toHaveTextContent('1')
  // 输入框清空并保持展开，方便连续添加
  expect(screen.getByRole('textbox', { name: '任务名称' })).toHaveValue('')
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '交电费',
    project_id: inbox.id,
  })

  create.release()
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: '完成「交电费」' })).toBeEnabled(),
  )
  expect(taskTitles()).toEqual(['交电费'])
})

test('完成任务：移出列表，可以撤销', async () => {
  const { api, backend } = setup()
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('checkbox', { name: '完成「买牛奶」' }))

  await waitFor(() => expect(taskTitles()).toEqual(['写周报']))
  expect(screen.getByRole('button', { name: /已完成\s*1/ })).toBeInTheDocument()
  expect(inboxBadge()).toHaveTextContent('1')
  expect(api.callsTo('PATCH /api/v1/tasks/t-milk')[0].body).toEqual({ status: 'done' })

  await user.click(await undoIn('已完成「买牛奶」'))
  // 回到原来的位置（按 sort_key 排在「写周报」前面）
  await waitFor(() => expect(taskTitles()).toEqual(['买牛奶', '写周报']))
  expect(backend.task('t-milk')?.status).toBe('todo')
})

test('在「已完成」里可以重新打开任务', async () => {
  const done = makeTask({
    id: 't-done',
    title: '已交房租',
    status: 'done',
    completed_at: '2026-10-31T00:00:00Z',
  })
  const backend = fakeBackend({ projects: [inbox], tasks: [done] })
  mockApi(signedIn(backend.routes))
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: /已完成\s*1/ }))
  await user.click(await screen.findByRole('checkbox', { name: '重新打开「已交房租」' }))

  await waitFor(() => expect(taskTitles()).toEqual(['已交房租']))
  expect(backend.task('t-done')?.status).toBe('todo')
  expect(screen.queryByRole('button', { name: /已完成/ })).not.toBeInTheDocument()
})

test('保存失败时回滚，并提示错误', async () => {
  setup({ 'PATCH /api/v1/tasks/:id': apiError(500, 'unknown') })
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('checkbox', { name: '完成「买牛奶」' }))

  expect(await screen.findByText('出了点问题，请稍后再试')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '完成「买牛奶」' })).not.toBeChecked()
  expect(taskTitles()).toEqual(['买牛奶', '写周报'])
  expect(inboxBadge()).toHaveTextContent('2')
})

test('删除任务后可以撤销', async () => {
  const { api } = setup()
  renderApp('/inbox')
  const user = userEvent.setup()

  const row = (await screen.findByText('买牛奶')).closest('li')!
  await user.click(within(row).getByRole('button', { name: '任务操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除' }))

  await waitFor(() => expect(taskTitles()).toEqual(['写周报']))
  expect(api.callsTo('DELETE /api/v1/tasks/t-milk')).toHaveLength(1)

  await user.click(await undoIn('已删除「买牛奶」'))
  await waitFor(() => expect(taskTitles()).toEqual(['买牛奶', '写周报']))
  expect(api.callsTo('POST /api/v1/tasks/t-milk/restore')).toHaveLength(1)
})

test('点击任务名称可以直接修改', async () => {
  const { api, backend } = setup()
  renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '编辑「买牛奶」' }))
  const input = screen.getByRole('textbox', { name: '任务名称' })
  await user.clear(input)
  await user.type(input, '买豆浆{Enter}')

  expect(await screen.findByRole('button', { name: '编辑「买豆浆」' })).toBeInTheDocument()
  expect(api.callsTo('PATCH /api/v1/tasks/t-milk')[0].body).toEqual({ title: '买豆浆' })
  expect(backend.task('t-milk')?.title).toBe('买豆浆')
})

test('把任务移到其他项目', async () => {
  const { api, backend } = setup()
  renderApp('/inbox')
  const user = userEvent.setup()

  const row = (await screen.findByText('买牛奶')).closest('li')!
  await user.click(within(row).getByRole('button', { name: '任务操作' }))
  // jsdom 没有布局，鼠标移向子菜单时 Radix 会判断为离开而关闭子菜单，这里用键盘操作
  ;(await screen.findByRole('menuitem', { name: '移动到' })).focus()
  await user.keyboard('{ArrowRight}')
  expect(await screen.findByRole('menuitem', { name: '工作' })).toHaveFocus()
  await user.keyboard('{Enter}')

  await waitFor(() => expect(taskTitles()).toEqual(['写周报']))
  expect(api.callsTo('PATCH /api/v1/tasks/t-milk')[0].body).toEqual({ project_id: work.id })
  expect(backend.task('t-milk')?.project_id).toBe(work.id)
})

test('新建项目后进入项目页', async () => {
  const created = makeProject({ id: 'p-reading', name: '读书', color: 'green' })
  const api = mockApi(signedIn({ 'POST /api/v1/projects': json(created, 201) }))
  const { router } = renderApp('/inbox')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: '新建项目' }))
  const dialog = await screen.findByRole('dialog', { name: '新建项目' })
  await user.click(within(dialog).getByRole('button', { name: '创建' }))
  expect(await within(dialog).findByText('此项为必填')).toBeInTheDocument()

  await user.type(within(dialog).getByLabelText('名称'), '读书')
  await user.click(within(dialog).getByRole('radio', { name: '绿色' }))
  await user.click(within(dialog).getByRole('button', { name: '创建' }))

  expect(await screen.findByRole('heading', { name: '读书' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/projects/p-reading')
  expect(screen.getByRole('link', { name: '读书' })).toBeInTheDocument()
  expect(api.callsTo('POST /api/v1/projects')[0].body).toEqual({ name: '读书', color: 'green' })
})

test('删除正在查看的项目后回到收件箱', async () => {
  const { api } = setup({ 'DELETE /api/v1/projects/p-work': empty() })
  const { router } = renderApp('/projects/p-work')
  const user = userEvent.setup()

  const header = (await screen.findByRole('heading', { name: '工作' })).parentElement!
  await user.click(within(header).getByRole('button', { name: '项目操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除项目' }))

  const dialog = await screen.findByRole('alertdialog', { name: '删除「工作」？' })
  expect(
    within(dialog).getByText('项目和其中的 1 个任务会被永久删除，无法恢复。'),
  ).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: '删除' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'))
  expect(api.callsTo('DELETE /api/v1/projects/p-work')).toHaveLength(1)
  expect(screen.queryByRole('link', { name: /工作/ })).not.toBeInTheDocument()
})

test('访问不存在的项目时给出提示', async () => {
  const api = mockApi(signedIn())
  renderApp('/projects/does-not-exist')

  expect(await screen.findByText('项目不存在，可能已被删除。')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '回到收件箱' })).toBeInTheDocument()
  expect(api.callsTo('GET /api/v1/tasks')).toHaveLength(0)
})
