/** M3：看板 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Project } from '@/features/projects/api'

import {
  fakeBackend,
  held,
  inbox,
  keyboardDrag,
  makeTask,
  mockApi,
  mockLayout,
  renderApp,
  signedIn,
  titlesIn,
  undoIn,
} from './render-app'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-03T04:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const board: Project = { ...inbox, layout: 'board' }
const done = { status: 'done' as const, completed_at: '2026-11-02T00:00:00Z' }

function setup(tasks: ReturnType<typeof makeTask>[], project = board) {
  const backend = fakeBackend({ projects: [project], tasks })
  const api = mockApi(signedIn(backend.routes))
  return { api, backend }
}

const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) })
const titles = (name: string) => titlesIn(column(name))
/** 用键盘拖动看板上的卡片 */
const dragCard = async (title: string, keys: string[]) =>
  keyboardDrag(
    await within(await screen.findByRole('main')).findByRole('link', { name: title }),
    keys,
  )

test('项目可以切换成看板，并记住这个选择', async () => {
  const { api, backend } = setup(
    [
      makeTask({ id: 't-a', title: '写接口', sort_key: 'a0' }),
      makeTask({ id: 't-b', title: '画设计稿', sort_key: 'a1', status: 'in_progress' }),
      makeTask({ id: 't-c', title: '联调', sort_key: 'a2', ...done }),
    ],
    inbox,
  )
  renderApp('/inbox')
  const user = userEvent.setup()
  // 列表里，进行中的任务带着标记
  const row = (await screen.findByRole('link', { name: '画设计稿' })).closest('li')!
  expect(within(row).getByText('进行中')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '看板' }))

  expect(await screen.findByRole('region', { name: /^待办/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '看板' })).toHaveAttribute('aria-pressed', 'true')
  expect(api.callsTo(`PATCH /api/v1/projects/${inbox.id}`)[0].body).toEqual({ layout: 'board' })
  await waitFor(() => expect(titles('已完成')).toEqual(['联调']))
  expect(titles('待办')).toEqual(['写接口'])
  expect(titles('进行中')).toEqual(['画设计稿'])
  // 每一列的数量
  expect(within(column('进行中')).getByRole('heading')).toHaveTextContent('进行中1')
  // 看板上不用再标「进行中」
  expect(within(column('进行中')).queryByText('进行中', { selector: 'span' })).toBeNull()
  expect(backend.project(inbox.id)?.layout).toBe('board')
})

test('用键盘把卡片移到另一列，以及在列里上下移动', async () => {
  mockLayout()
  const { api, backend } = setup([
    makeTask({ id: 't-a', title: 'a', sort_key: 'a0' }),
    makeTask({ id: 't-b', title: 'b', sort_key: 'a1' }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('待办')).toEqual(['a', 'b']))

  // 右方向键：移到空的「进行中」
  await dragCard('b', ['ArrowRight'])
  await waitFor(() => expect(titles('进行中')).toEqual(['b']))
  expect(titles('待办')).toEqual(['a'])
  expect(api.callsTo('POST /api/v1/tasks/t-b/move')[0].body).toEqual({
    after_id: null,
    status: 'in_progress',
  })
  await waitFor(() => expect(backend.task('t-b')?.status).toBe('in_progress'))
  // 拖到空的一列不改顺序
  expect(backend.task('t-b')?.sort_key).toBe('a1')

  await dragCard('a', ['ArrowRight'])
  await waitFor(() => expect(titles('进行中')).toEqual(['a', 'b']))

  // 上方向键：在这一列里往上移
  await dragCard('b', ['ArrowUp'])
  await waitFor(() => expect(titles('进行中')).toEqual(['b', 'a']))
  expect(api.callsTo('POST /api/v1/tasks/t-b/move')[1].body).toEqual({
    after_id: null,
    status: 'in_progress',
  })
  await waitFor(() =>
    expect(backend.task('t-b')!.sort_key < backend.task('t-a')!.sort_key).toBe(true),
  )
  // 拖拽过程中焦点一直在原来的卡片上
  expect(screen.getByRole('link', { name: 'b' })).toHaveFocus()
})

test('上下方向键不会跳到别的列', async () => {
  mockLayout()
  const { api } = setup([
    makeTask({ id: 't-a', title: 'a', sort_key: 'a0' }),
    makeTask({ id: 't-x', title: 'x', sort_key: 'a1', status: 'in_progress' }),
    makeTask({ id: 't-y', title: 'y', sort_key: 'a2', status: 'in_progress' }),
    makeTask({ id: 't-z', title: 'z', sort_key: 'a3', status: 'in_progress' }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('进行中')).toEqual(['x', 'y', 'z']))

  // 「待办」里只有一张：往下没有地方可去（旁边一列更靠下的卡片不算）
  await dragCard('a', ['ArrowDown'])
  expect(titles('待办')).toEqual(['a'])
  expect(api.callsTo('POST /api/v1/tasks/t-a/move')).toHaveLength(0)
})

test('拖到「已完成」等于勾选完成，撤销后回到原来的状态', async () => {
  mockLayout()
  const parent = makeTask({ id: 't-p', title: '发布', sort_key: 'a0', status: 'in_progress' })
  const child = makeTask({ id: 't-c', title: '打 tag', parent_id: 't-p', sort_key: 'a0' })
  const { api, backend } = setup([
    parent,
    child,
    makeTask({ id: 't-old', title: '以前完成的', sort_key: 'a1', ...done }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('已完成')).toEqual(['以前完成的']))

  await dragCard('发布', ['ArrowRight'])

  // 新完成的排在最前；子任务一起完成
  await waitFor(() => expect(titles('已完成')).toEqual(['发布', '以前完成的']))
  expect(titles('进行中')).toEqual([])
  expect(api.callsTo('PATCH /api/v1/tasks/t-p')[0].body).toEqual({ status: 'done' })
  await waitFor(() => expect(backend.task('t-c')?.status).toBe('done'))

  await userEvent.click(await undoIn('已完成「发布」'))
  await waitFor(() => expect(titles('进行中')).toEqual(['发布']))
  expect(api.callsTo('PATCH /api/v1/tasks/t-p')[1].body).toEqual({ status: 'in_progress' })
  await waitFor(() => expect(backend.task('t-c')?.status).toBe('todo'))

  // 从「已完成」拖回来：重新打开
  await dragCard('以前完成的', ['ArrowLeft', 'ArrowLeft'])
  await waitFor(() => expect(titles('待办')).toEqual(['以前完成的']))
  expect(api.callsTo('POST /api/v1/tasks/t-old/move')[0].body).toEqual({
    after_id: null,
    status: 'todo',
  })
  await waitFor(() => expect(backend.task('t-old')?.status).toBe('todo'))
})

test('从「已完成」拖出去又放回来：什么都不变', async () => {
  mockLayout()
  const { api } = setup([
    makeTask({ id: 't-x', title: 'x', sort_key: 'a0', ...done }),
    makeTask({
      id: 't-y',
      title: 'y',
      sort_key: 'a1',
      ...done,
      completed_at: '2026-11-01T00:00:00Z',
    }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('已完成')).toEqual(['x', 'y']))

  // 拖到「进行中」，再拖回「已完成」（经过时排在最前）后放下
  await dragCard('y', ['ArrowLeft', 'ArrowRight'])

  expect(titles('已完成')).toEqual(['x', 'y'])
  expect(titles('进行中')).toEqual([])
  expect(api.callsTo('PATCH /api/v1/tasks/t-y')).toHaveLength(0)
  expect(api.callsTo('POST /api/v1/tasks/t-y/move')).toHaveLength(0)
})

test('「已完成」一列加载失败时显示出来，可以重试', async () => {
  const backend = fakeBackend({
    projects: [board],
    tasks: [
      makeTask({ id: 't-a', title: '写接口' }),
      makeTask({ id: 't-c', title: '联调', ...done }),
    ],
  })
  const list = backend.routes['GET /api/v1/tasks']
  let failing = true
  mockApi(
    signedIn({
      ...backend.routes,
      'GET /api/v1/tasks': (request, params) =>
        failing && new URL(request.url).searchParams.get('done') === 'true'
          ? Response.json({ code: 'unknown', message: '' }, { status: 400 })
          : list(request, params),
    }),
  )
  renderApp('/inbox')
  const user = userEvent.setup()

  // 页面照常打开，只有「已完成」一列显示失败
  await waitFor(() => expect(titles('待办')).toEqual(['写接口']))
  expect(await within(column('已完成')).findByRole('alert')).toHaveTextContent('加载失败')

  failing = false
  await user.click(within(column('已完成')).getByRole('button', { name: '重试' }))
  await waitFor(() => expect(titles('已完成')).toEqual(['联调']))
})

test('快速来回切换列表和看板：按顺序保存，最后是最后选的那个', async () => {
  const backend = fakeBackend({ projects: [inbox], tasks: [] })
  const update = held(backend.routes['PATCH /api/v1/projects/:id'])
  const api = mockApi(signedIn({ ...backend.routes, 'PATCH /api/v1/projects/:id': update.handler }))
  renderApp('/inbox')
  const user = userEvent.setup()
  const calls = () => api.callsTo(`PATCH /api/v1/projects/${inbox.id}`)

  await user.click(await screen.findByRole('button', { name: '看板' }))
  await user.click(screen.getByRole('button', { name: '列表' }))
  // 第一次的还没返回，第二次的先不发
  expect(calls()).toHaveLength(1)
  expect(screen.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true')

  update.release()
  await waitFor(() => expect(calls()).toHaveLength(2))
  expect(calls().map((c) => c.body)).toEqual([{ layout: 'board' }, { layout: 'list' }])
  await waitFor(() => expect(backend.project(inbox.id)?.layout).toBe('list'))
  expect(screen.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true')
})

test('在「进行中」一列里添加的任务直接是进行中', async () => {
  const { api } = setup([])
  renderApp('/inbox')
  const user = userEvent.setup()
  const inProgress = await screen.findByRole('region', { name: /^进行中/ })

  await user.click(within(inProgress).getByRole('button', { name: '添加任务' }))
  await user.type(within(inProgress).getByRole('combobox', { name: '任务名称' }), '修 bug{Enter}')

  expect(titles('进行中')).toEqual(['修 bug'])
  expect(api.callsTo('POST /api/v1/tasks')[0].body).toEqual({
    title: '修 bug',
    project_id: inbox.id,
    status: 'in_progress',
  })
  expect(titles('待办')).toEqual([])
})

test('详情里可以改状态', async () => {
  const { api } = setup([makeTask({ id: 't-a', title: '写周报' })], inbox)
  renderApp('/inbox?task=t-a')
  const user = userEvent.setup()
  const panel = await screen.findByRole('dialog', { name: '任务详情' })

  await user.click(within(panel).getByRole('button', { name: '待办' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '进行中' }))

  expect(api.callsTo('PATCH /api/v1/tasks/t-a')[0].body).toEqual({ status: 'in_progress' })
  expect(within(panel).getByRole('button', { name: '进行中' })).toBeInTheDocument()
})

test('详情里再选一次当前的状态或优先级：什么都不变（已完成的不会被重新打开）', async () => {
  const { api } = setup([makeTask({ id: 't-a', title: '写周报', ...done })], inbox)
  renderApp('/inbox?task=t-a')
  const user = userEvent.setup()
  const panel = await screen.findByRole('dialog', { name: '任务详情' })

  // 已完成的任务不在列表的缓存里，详情要等请求回来
  await user.click(await within(panel).findByRole('button', { name: '已完成' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '已完成' }))
  await user.click(within(panel).getByRole('button', { name: '优先级 4' }))
  await user.click(await screen.findByRole('menuitemradio', { name: '优先级 4' }))

  expect(api.callsTo('PATCH /api/v1/tasks/t-a')).toHaveLength(0)
  expect(within(panel).getByRole('button', { name: '已完成' })).toBeInTheDocument()
})
