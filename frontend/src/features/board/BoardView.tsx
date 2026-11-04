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
import { DragGuards } from '@/components/sortable-list'
import { useDragSensors, useSortableItem } from '@/lib/sortable'
import { cn } from '@/lib/utils'

type Columns = Record<TaskStatus, Task[]>

// 每一列本身也是一个放置目标（空的列、列里任务下面的空白处），id 和任务的区分开
const COLUMN_PREFIX = 'column:'
const columnTarget = (status: TaskStatus) => `${COLUMN_PREFIX}${status}`
const targetColumn = (id: UniqueIdentifier): TaskStatus | undefined =>
  typeof id === 'string' && id.startsWith(COLUMN_PREFIX)
    ? (id.slice(COLUMN_PREFIX.length) as TaskStatus)
    : undefined

/** id 是任务时返回它在哪一列的第几个；是列本身时 index 为 -1，没有 task */
function locate(
  columns: Columns,
  id: UniqueIdentifier,
): { column: TaskStatus; index: number; task?: Task } | undefined {
  const column = targetColumn(id)
  if (column) return { column, index: -1 }
  for (const status of STATUSES) {
    const index = columns[status].findIndex((t) => t.id === id)
    if (index >= 0) return { column: status, index, task: columns[status][index] }
  }
  return undefined
}

/**
 * 放下的位置：卡片现在在哪一列（from 是它现在的位置）；在同一列里停在别的卡片上时，
 * 会放到那张卡片的位置（to），否则就是现在的位置。「已完成」一列不能调整位置
 */
function dropTarget(columns: Columns, activeId: UniqueIdentifier, overId?: UniqueIdentifier) {
  const at = locate(columns, activeId)
  if (!at?.task) return undefined
  const over = overId === undefined ? undefined : locate(columns, overId)
  const reorder = over && over.column === at.column && over.index >= 0 && at.column !== 'done'
  return { column: at.column, task: at.task, from: at.index, to: reorder ? over.index : at.index }
}

/**
 * 键盘：上下只在当前这一列里移动（默认会跳到旁边一列里更靠下的卡片上），左右换列。
 * 每一列是一个 SortableContext（id 是状态），按它过滤可以去的位置
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, droppableContainers, droppableRects } = args.context
  const column = active?.data.current?.sortable?.containerId
  if ((event.code !== 'ArrowUp' && event.code !== 'ArrowDown') || column === undefined) {
    return sortableKeyboardCoordinates(event, args)
  }
  const sameColumn = new Map(
    [...droppableRects].filter(
      ([id]) => droppableContainers.get(id)?.data.current?.sortable?.containerId === column,
    ),
  )
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableRects: sameColumn },
  })
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
      <DragGuards />
      <div
        data-wide
        className={cn(
          // 放不下三列时横向滑动（滚动区域伸到页面边距里，贴着屏幕边缘），每次停在一列的开头；
          // 拖动时不吸附，否则会和自动滚动打架
          '-mx-(--gutter) flex min-w-0 gap-3 overflow-x-auto px-(--gutter) pb-4',
          !active && 'snap-x snap-mandatory scroll-px-(--gutter)',
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
  /** 正在拖的卡片；放下后为 null，但在缓存更新之前继续显示 columns */
  activeId: UniqueIdentifier | null
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
  const [drag, setDragState] = useState<DragState | null>(null)
  // 事件回调里要读到最新的拖动状态（同一次事件里刚写入的也要），所以同时存一份在 ref 里
  const dragRef = useRef<DragState | null>(null)
  const setDrag = (next: DragState | null) => {
    dragRef.current = next
    setDragState(next)
  }
  // 拖动中显示拖动状态；放下后到缓存更新之前也继续显示，否则会闪回原来的位置。
  // 放下后 columns 一变（缓存已更新，或者失败回滚）就不再使用
  const shown = drag && (drag.activeId !== null || drag.base === columns) ? drag.columns : columns
  const active = drag?.activeId != null ? locate(shown, drag.activeId)?.task : undefined

  // 卡片刚换到另一列时布局还没稳定，这一帧里碰撞检测可能什么都碰不到，先当作停在原地
  const lastOverId = useRef<UniqueIdentifier | null>(null)
  const movedToNewColumn = useRef(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedToNewColumn.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [drag])

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
    if (movedToNewColumn.current) lastOverId.current = args.active.id
    return lastOverId.current != null ? [{ id: lastOverId.current }] : []
  }

  // 读屏软件的播报：哪一列第几个
  const describe = (id: UniqueIdentifier, overId?: UniqueIdentifier) => {
    const drop = dropTarget(dragRef.current?.columns ?? columns, id, overId)
    if (!drop) return { name: '', column: '', position: 0 }
    return {
      name: drop.task.title,
      column: t(`tasks.status.${drop.column}`),
      position: drop.to + 1,
    }
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

  const sensors = useDragSensors(boardKeyboardCoordinates)
  const dndProps: DndContextProps = {
    sensors,
    collisionDetection,
    accessibility: {
      announcements,
      screenReaderInstructions: { draggable: t('board.instructions') },
    },
    onDragStart: ({ active }) => setDrag({ activeId: active.id, base: columns, columns }),
    onDragOver: ({ active, over }) => {
      const state = dragRef.current
      if (!state || !over) return
      const from = locate(state.columns, active.id)
      const to = locate(state.columns, over.id)
      if (!from?.task || !to || from.column === to.column) return
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
          [to.column]: [...target.slice(0, index), from.task, ...target.slice(index)],
        },
      })
    },
    onDragEnd: ({ active, over }) => {
      const state = dragRef.current
      const drop = state && over && dropTarget(state.columns, active.id, over.id)
      if (!state || !drop) {
        setDrag(null)
        return
      }
      // 同一列里的位置由 dnd-kit 的排序动画决定，放下时才真正挪过去
      const order = arrayMove(state.columns[drop.column], drop.from, drop.to)
      const before = state.base[drop.column]
      const unchanged =
        locate(state.base, active.id)?.column === drop.column &&
        order.length === before.length &&
        order.every((task, i) => task.id === before[i].id)
      if (unchanged) {
        setDrag(null)
        return
      }
      setDrag({
        activeId: null,
        base: columns,
        columns: { ...state.columns, [drop.column]: order },
      })
      onMove(drop.task, drop.column, order)
    },
    onDragCancel: () => setDrag(null),
  }

  return { shown, active, dndProps }
}
