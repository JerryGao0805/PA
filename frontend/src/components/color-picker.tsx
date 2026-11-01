import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { COLOR_BG_CLASS, COLORS, type Color } from '@/lib/colors'
import { cn } from '@/lib/utils'

/** 一排色块，单选（role=radiogroup） */
export function ColorPicker({
  value,
  onChange,
}: {
  value: Color
  onChange: (color: Color) => void
}) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {COLORS.map((color) => {
        const selected = value === color
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(`colors.${color}`)}
            title={t(`colors.${color}`)}
            onClick={() => onChange(color)}
            className={cn(
              'flex size-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring',
              COLOR_BG_CLASS[color],
              selected && 'ring-2 ring-foreground/60',
            )}
          >
            {selected && <Check className="size-4" strokeWidth={3} />}
          </button>
        )
      })}
    </div>
  )
}
