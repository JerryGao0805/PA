import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KeyboardEvent, MouseEvent, SyntheticEvent, TouchEvent } from 'react'

// 拖拽排序的列表项。列表本身见 @/components/sortable-list

let activeDrags = 0
export const dragStarted = () => {
  activeDrags += 1
}
export const dragEnded = () => {
  activeDrags = Math.max(0, activeDrags - 1)
}
/** 是否正在拖拽。例如详情面板里拖动子任务时，Esc 应该取消拖拽，而不是关闭面板 */
export const isSorting = () => activeDrags > 0

// 从这些元素上按下时不开始拖拽，保留它们原来的点击行为（复选框、菜单按钮等）
const INTERACTIVE = 'button, input, textarea, [role="checkbox"], [role="menuitem"]'
const fromInteractive = (e: SyntheticEvent) =>
  e.target instanceof Element && e.target.closest(INTERACTIVE) !== null

/**
 * 列表里的一项。row 放在整行（li）上：鼠标在行内任意位置拖动、触屏长按；
 * handle 放在行里能获得焦点的主元素（标题链接）上：聚焦后按空格键拿起。
 */
export function useSortableItem(id: string, { disabled = false } = {}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  return {
    isDragging,
    row: {
      ref: setNodeRef,
      style: { transform: CSS.Translate.toString(transform), transition },
      onMouseDown: (e: MouseEvent) => {
        if (!fromInteractive(e)) listeners?.onMouseDown?.(e)
      },
      onTouchStart: (e: TouchEvent) => {
        if (!fromInteractive(e)) listeners?.onTouchStart?.(e)
      },
      // 键盘事件从标题链接冒泡上来；dnd-kit 会检查事件是不是来自 handle
      onKeyDown: (e: KeyboardEvent) => listeners?.onKeyDown?.(e),
    },
    handle: {
      ref: setActivatorNodeRef,
      'aria-describedby': disabled ? undefined : attributes['aria-describedby'],
    },
  }
}

export type SortableItem = ReturnType<typeof useSortableItem>
