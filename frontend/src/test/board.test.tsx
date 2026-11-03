/** M3：看板 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Project } from '@/features/projects/api'

import { fakeBackend, inbox, makeTask, mockApi, renderApp, signedIn } from './render-app'

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
const titles = (name: string) =>
  within(column(name))
    .queryAllByRole('listitem')
    .map((li) => within(li).queryByRole('link')?.textContent ?? li.textContent)

/**
 * jsdom 不做布局，所有元素的位置都是 0。dnd-kit 的键盘拖拽要靠位置找方向键指向的目标，
 * 这里把三列从左到右排开（每列 300px 宽），列里的卡片从上到下排开（每张 50px 高）。
 * 拖动时跟着走的浮层（DragOverlay）用 dnd-kit 写在它上面的位置和大小，碰撞检测用的是它。
 */
function layoutBoard() {
  const original = Element.prototype.getBoundingClientRect
  const rect = (left: number, top: number, width: number, height: number) => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const overlay = this.closest<HTMLElement>('[style*="position: fixed"]')
    if (overlay) {
      const { left, top, width, height } = overlay.style
      return rect(parseFloat(left), parseFloat(top), parseFloat(width), parseFloat(height))
    }
    const section = this.closest('section[aria-labelledby^="board-column-"]')
    if (!section?.parentElement) return original.call(this)
    const left = Array.from(section.parentElement.children).indexOf(section) * 300
    if (this === section) return rect(left, 0, 280, 600)
    if (this.tagName === 'LI' && this.parentElement) {
      return rect(left, 40 + Array.from(this.parentElement.children).indexOf(this) * 50, 280, 44)
    }
    return original.call(this)
  })
}

/** 聚焦卡片标题，用键盘拿起、按方向键、放下 */
async function keyboardDrag(title: string, keys: string[]) {
  const user = userEvent.setup()
  const main = within(await screen.findByRole('main'))
  ;(await main.findByRole('link', { name: title })).focus()
  await user.keyboard('[Space]')
  for (const key of keys) await user.keyboard(`[${key}]`)
  await user.keyboard('[Space]')
  return user
}

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
  layoutBoard()
  const { api, backend } = setup([
    makeTask({ id: 't-a', title: 'a', sort_key: 'a0' }),
    makeTask({ id: 't-b', title: 'b', sort_key: 'a1' }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('待办')).toEqual(['a', 'b']))

  // 右方向键：移到空的「进行中」
  await keyboardDrag('b', ['ArrowRight'])
  await waitFor(() => expect(titles('进行中')).toEqual(['b']))
  expect(titles('待办')).toEqual(['a'])
  expect(api.callsTo('POST /api/v1/tasks/t-b/move')[0].body).toEqual({
    after_id: null,
    status: 'in_progress',
  })
  await waitFor(() => expect(backend.task('t-b')?.status).toBe('in_progress'))
  // 拖到空的一列不改顺序
  expect(backend.task('t-b')?.sort_key).toBe('a1')

  await keyboardDrag('a', ['ArrowRight'])
  await waitFor(() => expect(titles('进行中')).toEqual(['a', 'b']))

  // 上方向键：在这一列里往上移
  await keyboardDrag('b', ['ArrowUp'])
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
  layoutBoard()
  const { api } = setup([
    makeTask({ id: 't-a', title: 'a', sort_key: 'a0' }),
    makeTask({ id: 't-x', title: 'x', sort_key: 'a1', status: 'in_progress' }),
    makeTask({ id: 't-y', title: 'y', sort_key: 'a2', status: 'in_progress' }),
    makeTask({ id: 't-z', title: 'z', sort_key: 'a3', status: 'in_progress' }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('进行中')).toEqual(['x', 'y', 'z']))

  // 「待办」里只有一张：往下没有地方可去（旁边一列更靠下的卡片不算）
  await keyboardDrag('a', ['ArrowDown'])
  expect(titles('待办')).toEqual(['a'])
  expect(api.callsTo('POST /api/v1/tasks/t-a/move')).toHaveLength(0)
})

test('拖到「已完成」等于勾选完成，撤销后回到原来的状态', async () => {
  layoutBoard()
  const parent = makeTask({ id: 't-p', title: '发布', sort_key: 'a0', status: 'in_progress' })
  const child = makeTask({ id: 't-c', title: '打 tag', parent_id: 't-p', sort_key: 'a0' })
  const { api, backend } = setup([
    parent,
    child,
    makeTask({ id: 't-old', title: '以前完成的', sort_key: 'a1', ...done }),
  ])
  renderApp('/inbox')
  await waitFor(() => expect(titles('已完成')).toEqual(['以前完成的']))

  await keyboardDrag('发布', ['ArrowRight'])

  // 新完成的排在最前；子任务一起完成
  await waitFor(() => expect(titles('已完成')).toEqual(['发布', '以前完成的']))
  expect(titles('进行中')).toEqual([])
  expect(api.callsTo('PATCH /api/v1/tasks/t-p')[0].body).toEqual({ status: 'done' })
  await waitFor(() => expect(backend.task('t-c')?.status).toBe('done'))

  const toast = (await screen.findByText('已完成「发布」')).closest('li')!
  await userEvent.click(within(toast).getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(titles('进行中')).toEqual(['发布']))
  expect(api.callsTo('PATCH /api/v1/tasks/t-p')[1].body).toEqual({ status: 'in_progress' })
  await waitFor(() => expect(backend.task('t-c')?.status).toBe('todo'))

  // 从「已完成」拖回来：重新打开
  await keyboardDrag('以前完成的', ['ArrowLeft', 'ArrowLeft'])
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
