import type { ProjectColor } from './api'

export const PROJECT_COLORS: readonly ProjectColor[] = [
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
export const PROJECT_COLOR_CLASS: Record<ProjectColor, string> = {
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
