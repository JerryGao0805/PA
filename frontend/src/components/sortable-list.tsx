import {
  closestCenter,
  DndContext,
  useDndMonitor,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { dragEnded, dragStarted, useDragSensors } from '@/lib/sortable'

/**
 * 拖拽结束时鼠标还停在被拖的那一行上，浏览器会接着触发一次 click。dnd-kit 只在 document 上
 * 阻止了它的传播（松手后 50ms 内的 click 都会被拦），链接的默认行为（整页跳转）还在，
 * 所以在更早的 window 捕获阶段把它拦下来。在拖拽开始时调用；只拦一次。返回的函数在拖拽结束后调用，和 dnd-kit 一样，50ms 内没有 click（触屏，
 * 或者被拖的元素换了位置）就撤掉拦截。键盘拖拽不会多出 click，不拦。
 */
function blockNextClick(activatorEvent: Event): () => void {
  if (activatorEvent instanceof globalThis.KeyboardEvent) return () => {}
  const remove = () => window.removeEventListener('click', block, { capture: true })
  const block = (e: globalThis.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    remove()
  }
  window.addEventListener('click', block, { capture: true })
  return () => setTimeout(remove, 50)
}

/**
 * 每个 DndContext 里都要放一个：记录正在拖拽（isSorting），并拦下指针拖拽松手后的那次 click
 */
export function DragGuards() {
  const unblock = useRef<(() => void) | null>(null)
  const finish = () => {
    dragEnded()
    unblock.current?.()
    unblock.current = null
  }
  useDndMonitor({
    onDragStart: ({ activatorEvent }) => {
      dragStarted()
      unblock.current = blockNextClick(activatorEvent)
    },
    onDragEnd: finish,
    onDragCancel: finish,
  })
  return null
}

interface SortableListProps<T extends { id: string }> {
  items: T[]
  /** 读屏软件播报时用的名字 */
  getName: (item: T) => string
  /** 放下后调用：item 被放到了 after 后面（null 表示最前），order 是新的顺序 */
  onMove: (item: T, after: T | null, order: T[]) => void
  /** 渲染列表；每一项要用 useSortableItem（@/lib/sortable） */
  children: (items: T[]) => ReactNode
}

/**
 * 竖直方向的拖拽排序：鼠标按住拖动、触屏长按后拖动、键盘空格键拿起后用方向键移动。
 * 只负责交互，新的顺序由 onMove 交给调用方保存。
 */
export function SortableList<T extends { id: string }>({
  items,
  getName,
  onMove,
  children,
}: SortableListProps<T>) {
  const { t } = useTranslation()
  const sensors = useDragSensors()
  // 放下后到数据更新之前先按新顺序显示，否则列表会闪回原来的顺序。
  // items 一变（缓存已更新，或者失败回滚）就不再使用
  const [dropped, setDropped] = useState<{ base: T[]; order: T[] } | null>(null)
  const shown = dropped?.base === items ? dropped.order : items

  const nameOf = (id: UniqueIdentifier) => {
    const item = shown.find((i) => i.id === id)
    return item ? getName(item) : ''
  }
  const positionOf = (id: UniqueIdentifier) => shown.findIndex((i) => i.id === id) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('sortable.picked', { name: nameOf(active.id), position: positionOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t('sortable.over', { name: nameOf(active.id), position: positionOf(over.id) }) : '',
    onDragEnd: ({ active, over }) =>
      over
        ? t('sortable.dropped', { name: nameOf(active.id), position: positionOf(over.id) })
        : t('sortable.cancelled', { name: nameOf(active.id) }),
    onDragCancel: ({ active }) => t('sortable.cancelled', { name: nameOf(active.id) }),
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('sortable.instructions') },
      }}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return
        const from = shown.findIndex((i) => i.id === active.id)
        const to = shown.findIndex((i) => i.id === over.id)
        if (from < 0 || to < 0) return
        const order = arrayMove(shown, from, to)
        setDropped({ base: items, order })
        onMove(order[to], order[to - 1] ?? null, order)
      }}
    >
      <DragGuards />
      <SortableContext items={shown} strategy={verticalListSortingStrategy}>
        {children(shown)}
      </SortableContext>
    </DndContext>
  )
}
