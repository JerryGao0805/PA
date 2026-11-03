import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type Announcements,
  type CollisionDetection,
  type DndContextProps,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { Project } from '@/features/projects/api'
import { AddTask } from '@/features/tasks/AddTask'
import {
  DONE_LIST_LIMIT,
  isPendingTask,
  tasksQuery,
  useMoveTask,
  type Task,
  type TaskStatus,
} from '@/features/tasks/api'
import { STATUS_ICON, STATUS_TEXT_CLASS, STATUSES } from '@/features/tasks/status'
import { useToggleDone } from '@/features/tasks/task-actions'
import { TaskItem } from '@/features/tasks/TaskItem'
import {
  blockNextClick,
  dragEnded,
  dragStarted,
  useDragSensors,
  useSortableItem,
} from '@/lib/sortable'
import { cn } from '@/lib/utils'

type Columns = Record<TaskStatus, Task[]>

// 每一列本身也是一个放置目标（空的列、列里任务下面的空白处），id 和任务的区分开
const COLUMN_PREFIX = 'column:'
const columnTarget = (status: TaskStatus) => `${COLUMN_PREFIX}${status}`
const targetColumn = (id: UniqueIdentifier): TaskStatus | undefined =>
  typeof id === 'string' && id.startsWith(COLUMN_PREFIX)
    ? (id.slice(COLUMN_PREFIX.length) as TaskStatus)
    : undefined

/** id 是任务时返回它在哪一列的第几个；是列本身时 index 为 -1 */
function locate(columns: Columns, id: UniqueIdentifier) {
  const column = targetColumn(id)
  if (column) return { column, index: -1 }
  for (const status of STATUSES) {
    const index = columns[status].findIndex((t) => t.id === id)
    if (index >= 0) return { column: status, index }
  }
  return undefined
}

/**
 * 看板：项目里的顶层任务按状态分成三列。待办和进行中按手动顺序（和列表视图是同一个顺序），
 * 已完成按完成时间（新的在前）。拖到另一列就是改状态，拖到「已完成」等于勾选完成。
 */
export function BoardView({ project }: { project: Project }) {
  const { data: open } = useSuspenseQuery(tasksQuery({ project_id: project.id }))
  // 切换到看板时才需要；路由在看板模式下会预先加载，平时不用等
  const { data: done } = useQuery(tasksQuery({ project_id: project.id, done: true }))
  const columns = useMemo<Columns>(
    () => ({
      todo: open.filter((t) => t.status === 'todo'),
      in_progress: open.filter((t) => t.status === 'in_progress'),
      done: done ?? [],
    }),
    [open, done],
  )
  const move = useMoveTask()
  const toggle = useToggleDone()
  const { shown, active, dndProps } = useBoardDrag(columns, (task, column, order) => {
    if (column === 'done') toggle(task)
    else move(task, order, column)
  })
  // 拖动中，「已完成」的数量跟着拖进拖出变化
  const doneCount = project.done_task_count + shown.done.length - columns.done.length

  return (
    <DndContext {...dndProps}>
      <div
        data-layout="board"
        className={cn(
          // 手机上一屏放不下三列：横向滑动，每次停在一列的开头（拖动时不吸附，否则会和自动滚动打架）
          '-mx-4 flex min-w-0 gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0',
          !active && 'snap-x snap-mandatory scroll-px-4 sm:scroll-px-0',
        )}
      >
        {STATUSES.map((status) => (
          <BoardColumn
            key={status}
            project={project}
            status={status}
            tasks={shown[status]}
            count={status === 'done' ? doneCount : shown[status].length}
            loading={status === 'done' && !done}
          />
        ))}
      </div>
      {createPortal(
        <DragOverlay>
          {active && (
            <ul inert aria-hidden className="cursor-grabbing rounded-lg shadow-lg">
              <TaskItem task={active} variant="card" />
            </ul>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

interface BoardColumnProps {
  project: Project
  status: TaskStatus
  tasks: Task[]
  count: number
  loading: boolean
}

function BoardColumn({ project, status, tasks, count, loading }: BoardColumnProps) {
  const { t } = useTranslation()
  const { setNodeRef } = useDroppable({ id: columnTarget(status) })
  const Icon = STATUS_ICON[status]
  const headingId = `board-column-${status}`

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className="flex w-[min(85vw,20rem)] shrink-0 snap-start flex-col gap-2 rounded-xl bg-muted/50 p-2 md:w-0 md:min-w-60 md:flex-1"
    >
      <h2 id={headingId} className="flex items-center gap-2 px-1.5 pt-1 text-sm font-semibold">
        <Icon aria-hidden className={cn('size-4', STATUS_TEXT_CLASS[status])} />
        {t(`tasks.status.${status}`)}
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      </h2>
      <SortableContext id={status} items={tasks} strategy={verticalListSortingStrategy}>
        <ul className="grid gap-2">
          {tasks.map((task) => (
            <BoardCard key={task.id} task={task} fixed={status === 'done'} />
          ))}
        </ul>
      </SortableContext>
      {tasks.length === 0 && (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          {loading ? t('common.loading') : t('board.empty')}
        </p>
      )}
      {status === 'done' ? (
        count > DONE_LIST_LIMIT && (
          <p className="px-1.5 text-xs text-muted-foreground">{t('tasks.doneLimitHint')}</p>
        )
      ) : (
        <div className="px-1.5">
          <AddTask defaults={{ project_id: project.id, status }} />
        </div>
      )}
    </section>
  )
}

/** fixed：「已完成」一列按完成时间排列，卡片可以拖走，但不能在列里调整位置 */
function BoardCard({ task, fixed }: { task: Task; fixed: boolean }) {
  // 还没保存好的新任务不能拖
  const sortable = useSortableItem(task.id, { disabled: isPendingTask(task), fixed })
  return <TaskItem task={task} variant="card" sortable={sortable} />
}

interface DragState {
  /** 开始拖动（或放下）时的数据 */
  base: Columns
  /** 拖动过程中卡片在各列里的位置 */
  columns: Columns
}

/**
 * 跨列拖拽（dnd-kit 的「多个容器」做法）：拖动过程中卡片一进入另一列，就在本地状态里把它挪过去，
 * 让那一列给它让出位置；放下时再按列内的位置排好，交给 onMove 保存。
 */
function useBoardDrag(
  columns: Columns,
  onMove: (task: Task, column: TaskStatus, order: Task[]) => void,
) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [drag, setDragState] = useState<DragState | null>(null)
  // 事件回调里要读到最新的拖动状态（同一次事件里刚写入的也要），所以同时存一份在 ref 里
  const dragRef = useRef<DragState | null>(null)
  const setDrag = (next: DragState | null) => {
    dragRef.current = next
    setDragState(next)
  }
  // 拖动中显示拖动状态；放下后到缓存更新之前也继续显示，否则会闪回原来的位置。
  // 放下后 columns 一变（缓存已更新，或者失败回滚）就不再使用
  const shown = drag && (activeId !== null || drag.base === columns) ? drag.columns : columns
  const active = activeId === null ? undefined : locateTask(shown, activeId)

  // 卡片刚换到另一列时布局还没稳定，这一帧里碰撞检测可能什么都碰不到，先当作停在原地
  const lastOverId = useRef<UniqueIdentifier | null>(null)
  const movedToNewColumn = useRef(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedToNewColumn.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [drag])
  const unblock = useRef<(() => void) | null>(null)

  const collisionDetection: CollisionDetection = (args) => {
    // 鼠标、触屏：指针所在的目标；键盘没有指针，用矩形重叠
    const pointer = pointerWithin(args)
    const hits = pointer.length > 0 ? pointer : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    if (overId != null) {
      // 停在列里的空白处：换成这一列里离得最近的卡片，这样能放到中间某个位置。
      // 「已完成」一列的卡片不是放置目标，停在那一列就是那一列
      const column = targetColumn(overId)
      if (column && column !== 'done' && shown[column].length > 0) {
        const ids = new Set<UniqueIdentifier>(shown[column].map((task) => task.id))
        const nearest = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => ids.has(c.id)),
        })
        overId = nearest[0]?.id ?? overId
      }
      lastOverId.current = overId
      return [{ id: overId }]
    }
    if (movedToNewColumn.current) lastOverId.current = activeId
    return lastOverId.current != null ? [{ id: lastOverId.current }] : []
  }

  // 键盘：上下只在当前这一列里移动（默认会跳到旁边一列里更靠下的卡片上），左右换列
  const coordinateGetter: KeyboardCoordinateGetter = (event, args) => {
    const state = dragRef.current
    const at = state && args.context.active ? locate(state.columns, args.context.active.id) : null
    if ((event.code !== 'ArrowUp' && event.code !== 'ArrowDown') || !state || !at) {
      return sortableKeyboardCoordinates(event, args)
    }
    const ids = new Set<UniqueIdentifier>(state.columns[at.column].map((task) => task.id))
    const all = args.context.droppableContainers
    const sameColumn = {
      get: (id: UniqueIdentifier) => all.get(id),
      getEnabled: () => all.getEnabled().filter((c) => ids.has(c.id)),
    } as typeof all
    return sortableKeyboardCoordinates(event, {
      ...args,
      context: { ...args.context, droppableContainers: sameColumn },
    })
  }
  const sensors = useDragSensors(coordinateGetter)

  // 读屏软件的播报：哪一列第几个
  const describe = (id: UniqueIdentifier, overId?: UniqueIdentifier) => {
    const state = dragRef.current?.columns ?? columns
    const at = locate(state, id)
    const task = at && at.index >= 0 ? state[at.column][at.index] : undefined
    if (!at || !task) return { name: '', column: '', position: 0 }
    const over = overId === undefined ? undefined : locate(state, overId)
    // 在同一列里停在别的卡片上：会放到那张卡片的位置
    const index =
      over && over.column === at.column && over.index >= 0 && at.column !== 'done'
        ? over.index
        : at.index
    return { name: task.title, column: t(`tasks.status.${at.column}`), position: index + 1 }
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('board.picked', describe(active.id)),
    onDragOver: ({ active, over }) => (over ? t('board.over', describe(active.id, over.id)) : ''),
    onDragEnd: ({ active, over }) =>
      over
        ? t('board.dropped', describe(active.id))
        : t('sortable.cancelled', { name: describe(active.id).name }),
    onDragCancel: ({ active }) => t('sortable.cancelled', { name: describe(active.id).name }),
  }

  const finish = () => {
    dragEnded()
    unblock.current?.()
    unblock.current = null
    setActiveId(null)
  }

  const dndProps: DndContextProps = {
    sensors,
    collisionDetection,
    accessibility: {
      announcements,
      screenReaderInstructions: { draggable: t('board.instructions') },
    },
    onDragStart: ({ active, activatorEvent }) => {
      dragStarted()
      unblock.current = blockNextClick(activatorEvent)
      setActiveId(active.id)
      setDrag({ base: columns, columns })
    },
    onDragOver: ({ active, over }) => {
      const state = dragRef.current
      if (!state || !over) return
      const from = locate(state.columns, active.id)
      const to = locate(state.columns, over.id)
      if (!from || !to || from.index < 0 || from.column === to.column) return
      const task = state.columns[from.column][from.index]
      const target = state.columns[to.column]
      let index: number
      if (to.column === 'done') {
        // 新完成的排在最前
        index = 0
      } else if (to.index < 0) {
        index = target.length
      } else {
        // 指针在那张卡片的下半部分就放到它后面
        const rect = active.rect.current.translated
        index = to.index + (rect && rect.top > over.rect.top + over.rect.height / 2 ? 1 : 0)
      }
      movedToNewColumn.current = true
      setDrag({
        ...state,
        columns: {
          ...state.columns,
          [from.column]: state.columns[from.column].filter((t) => t.id !== active.id),
          [to.column]: [...target.slice(0, index), task, ...target.slice(index)],
        },
      })
    },
    onDragEnd: ({ active, over }) => {
      finish()
      const state = dragRef.current
      const at = state && locate(state.columns, active.id)
      if (!state || !over || !at || at.index < 0) {
        setDrag(null)
        return
      }
      // 同一列里的位置由 dnd-kit 的排序动画决定，放下时才真正挪过去
      let order = state.columns[at.column]
      const target = locate(state.columns, over.id)
      if (at.column !== 'done' && target?.column === at.column && target.index >= 0) {
        order = arrayMove(order, at.index, target.index)
      }
      const before = state.base[at.column]
      const unchanged =
        locate(state.base, active.id)?.column === at.column &&
        order.length === before.length &&
        order.every((task, i) => task.id === before[i].id)
      if (unchanged) {
        setDrag(null)
        return
      }
      setDrag({ base: columns, columns: { ...state.columns, [at.column]: order } })
      onMove(
        order.find((task) => task.id === active.id)!,
        at.column,
        order,
      )
    },
    onDragCancel: () => {
      finish()
      setDrag(null)
    },
  }

  return { shown, active, dndProps }
}

function locateTask(columns: Columns, id: UniqueIdentifier): Task | undefined {
  const at = locate(columns, id)
  return at && at.index >= 0 ? columns[at.column][at.index] : undefined
}
