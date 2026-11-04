/** M3：看板 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Project } from '@/features/projects/api'

import {
  fakeBackend,
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

test('在「进行中」一列里添加的任务直接是进行中', async () => {
  const { api } = setup([])
  renderApp('/inbox')
  const user = userEvent.setup()
  const inProgress = await screen.findByRole('region', { name: /^进行中/ })

  await user.click(within(inProgress).getByRole('button', { name: '添加任务' }))
  await user.type(within(inProgress).getByRole('textbox', { name: '任务名称' }), '修 bug{Enter}')

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
