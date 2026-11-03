import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KeyboardEvent, MouseEvent, SyntheticEvent, TouchEvent } from 'react'

// 拖拽排序的列表项，以及列表和看板共用的小工具。列表本身见 @/components/sortable-list

let activeDrags = 0
export const dragStarted = () => {
  activeDrags += 1
}
export const dragEnded = () => {
  activeDrags = Math.max(0, activeDrags - 1)
}
/** 是否正在拖拽。例如详情面板里拖动子任务时，Esc 应该取消拖拽，而不是关闭面板 */
export const isSorting = () => activeDrags > 0

/**
 * 拖拽结束时鼠标还停在被拖的那一行上，浏览器会接着触发一次 click。dnd-kit 只在 document 上
 * 阻止了它的传播（松手后 50ms 内的 click 都会被拦），链接的默认行为（整页跳转）还在，
 * 所以在更早的 window 捕获阶段把它拦下来。在拖拽开始时调用，传入 dnd-kit 的 activatorEvent；
 * 只拦一次。返回的函数在拖拽结束后调用，和 dnd-kit 一样，50ms 内没有 click（触屏，
 * 或者被拖的元素换了位置）就撤掉拦截。键盘拖拽不会多出 click，不拦。
 */
export function blockNextClick(activatorEvent: Event): () => void {
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

// 只用空格键拿起：拖拽的触发元素是链接，回车要留给链接本身（打开）
const KEYBOARD_CODES: KeyboardCodes = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter', 'Tab'],
}

/** 鼠标、触屏、键盘三种拖拽方式，列表和看板用同样的手感 */
export function useDragSensors(
  coordinateGetter: KeyboardCoordinateGetter = sortableKeyboardCoordinates,
) {
  return useSensors(
    // 移动超过 5px 才算拖拽，单击仍然是单击
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // 长按 250ms 才开始拖拽，在那之前手指移动就是正常滚动
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter, keyboardCodes: KEYBOARD_CODES }),
  )
}

// 从这些元素上按下时不开始拖拽，保留它们原来的点击行为（复选框、菜单按钮等）
const INTERACTIVE = 'button, input, textarea, [role="checkbox"], [role="menuitem"]'
const fromInteractive = (e: SyntheticEvent) =>
  e.target instanceof Element && e.target.closest(INTERACTIVE) !== null

interface SortableItemOptions {
  /** 不能拖动（例如还没保存好的新任务） */
  disabled?: boolean
  /** 能拖走，但别的项不能放到它的位置上（例如看板「已完成」一列按完成时间排列） */
  fixed?: boolean
}

/**
 * 列表里的一项。row 放在整行（li）上：鼠标在行内任意位置拖动、触屏长按；
 * handle 放在行里能获得焦点的主元素（标题链接）上：聚焦后按空格键拿起。
 */
export function useSortableItem(
  id: string,
  { disabled = false, fixed = false }: SortableItemOptions = {},
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: { draggable: disabled, droppable: disabled || fixed } })

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
