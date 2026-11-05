import { useSuspenseQuery } from '@tanstack/react-query'
import { Plus, Tag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { FittedPopoverContent } from '@/components/fitted-popover'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { hasWhitespace, LABEL_NAME_MAX, labelsQuery, useCreateLabel } from '@/features/labels/api'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { errorMessage } from '@/lib/api-error'

interface LabelPickerProps {
  value: string[]
  onChange: (labelIds: string[]) => void
}

/** 已选的标签 + 「添加标签」：弹出可搜索的列表，没有匹配时可以直接新建 */
export function LabelPicker({ value, onChange }: LabelPickerProps) {
  const { t } = useTranslation()
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const create = useCreateLabel()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = labels.filter((l) => value.includes(l.id))
  const name = search.trim()
  const exists = labels.some((l) => l.name.toLowerCase() === name.toLowerCase())
  // 和后端的规则一致；不合法时把原因显示在「创建」那一项上
  const invalidReason = hasWhitespace(name)
    ? t('tasks.labelPicker.noSpaces')
    : name.length > LABEL_NAME_MAX
      ? t('labels.form.nameMax')
      : null

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  const createAndAdd = () => {
    create.mutate(
      { name },
      {
        onSuccess: (label) => {
          onChange([...value, label.id])
          setSearch('')
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((label) => (
        <button
          key={label.id}
          type="button"
          onClick={() => toggle(label.id)}
          aria-label={t('tasks.labelPicker.remove', { name: label.name })}
          title={t('tasks.labelPicker.remove', { name: label.name })}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-muted px-2.5 text-xs outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <LabelIcon color={label.color} className="size-3.5" />
          {label.name}
        </button>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch('')
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 font-normal text-muted-foreground">
            <Tag />
            {t('tasks.labelPicker.add')}
          </Button>
        </PopoverTrigger>
        <FittedPopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput
              // 手机上 16px：iOS Safari 聚焦小于 16px 的输入框时会放大页面
              className="text-base md:text-sm"
              placeholder={t('tasks.labelPicker.placeholder')}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{t('tasks.labelPicker.empty')}</CommandEmpty>
              {labels.length > 0 && (
                <CommandGroup>
                  {labels.map((label) => (
                    <CommandItem
                      key={label.id}
                      value={label.name}
                      data-checked={value.includes(label.id)}
                      onSelect={() => toggle(label.id)}
                    >
                      <LabelIcon color={label.color} />
                      <span className="truncate">{label.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {name && !exists && (
                <CommandGroup forceMount>
                  <CommandItem
                    forceMount
                    value={`create ${name}`}
                    disabled={!!invalidReason || create.isPending}
                    onSelect={createAndAdd}
                  >
                    <Plus />
                    <span className="truncate">
                      {invalidReason ?? t('tasks.labelPicker.create', { name })}
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </FittedPopoverContent>
      </Popover>
    </div>
  )
}
