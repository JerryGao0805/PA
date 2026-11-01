import type { components } from '@/lib/api-schema'

/** 项目和标签共用的调色板（后端只存颜色名） */
export type Color = components['schemas']['ProjectOut']['color']

export const COLORS: readonly Color[] = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
]

// 完整的类名要原样写在源码里，Tailwind 才能扫描到并生成样式
export const COLOR_BG_CLASS: Record<Color, string> = {
  gray: 'bg-zinc-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
}

/** 图标、文字用的颜色：比背景色深一档，保证和白底的对比度 */
export const COLOR_TEXT_CLASS: Record<Color, string> = {
  gray: 'text-zinc-500',
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-orange-600 dark:text-orange-400',
  amber: 'text-amber-600 dark:text-amber-400',
  green: 'text-green-600 dark:text-green-400',
  teal: 'text-teal-600 dark:text-teal-400',
  blue: 'text-blue-600 dark:text-blue-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  violet: 'text-violet-600 dark:text-violet-400',
  pink: 'text-pink-600 dark:text-pink-400',
}
