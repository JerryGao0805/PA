import { ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { timezoneLabel, timezoneOptions, utcOffset } from '@/lib/timezone'

/** 选时区：点开后可以搜索（城市名、「UTC+8」都行） */
export function TimezonePicker({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (timeZone: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // 四百多个时区，打开时才算一遍各自的 UTC 偏移
  const options = useMemo(
    () => (open ? timezoneOptions(value).map((tz) => ({ tz, offset: utcOffset(tz) })) : []),
    [open, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{timezoneLabel(value)}</span>
          <span className="ml-auto text-muted-foreground">{utcOffset(value)}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command label={t('settings.timezone.label')}>
          <CommandInput placeholder={t('settings.timezone.search')} />
          <CommandList>
            <CommandEmpty>{t('settings.timezone.empty')}</CommandEmpty>
            <CommandGroup>
              {options.map(({ tz, offset }) => (
                <CommandItem
                  key={tz}
                  value={tz}
                  // 输入「new york」「utc+8」也能找到
                  keywords={[timezoneLabel(tz), offset]}
                  data-checked={tz === value}
                  onSelect={() => {
                    onChange(tz)
                    setOpen(false)
                  }}
                >
                  {/* 名字占满剩下的宽度：偏移和末尾「已选中」的勾都靠右 */}
                  <span className="flex-1 truncate">{timezoneLabel(tz)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{offset}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
