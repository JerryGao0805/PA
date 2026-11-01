import { Tag } from 'lucide-react'

import { COLOR_TEXT_CLASS, type Color } from '@/lib/colors'
import { cn } from '@/lib/utils'

export function LabelIcon({ color, className }: { color: Color; className?: string }) {
  return <Tag aria-hidden className={cn('size-4 shrink-0', COLOR_TEXT_CLASS[color], className)} />
}
