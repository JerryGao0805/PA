import { CalendarDays, Flag, Inbox, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { describeDue, PRIORITIES, PRIORITY_TEXT_CLASS } from '@/features/tasks/due'
import type { Color } from '@/lib/colors'
import { useToday } from '@/features/tasks/use-today'
import { cn } from '@/lib/utils'

import { findTrigger, type Token, type Trigger } from './parse'
import type { TaskInputState } from './use-task-input'

const MAX_SUGGESTIONS = 8

/** 候选里的一项：项目或标签 */
interface Item {
  id: string
  name: string
  color: Color
  is_inbox?: boolean
}

/** 候选：名字里包含输入的文字；和输入一样的排第一（回车直接提交靠它），开头就匹配的其次 */
function suggestionsFor(trigger: Trigger, items: Item[]): Item[] {
  const query = trigger.query.toLowerCase()
  const rank = (item: Item) => {
    const name = item.name.toLowerCase()
    return name === query ? 2 : name.startsWith(query) ? 1 : 0
  }
  return items
    .filter((item) => item.name.toLowerCase().includes(query))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, MAX_SUGGESTIONS)
}

interface TaskInputProps {
  state: TaskInputState
  /** 输入框的名字（读屏软件读的） */
  label: string
  placeholder?: string
  inputRef?: RefObject<HTMLInputElement | null>
  autoFocus?: boolean
  className?: string
  /** 候选列表没打开时按 Esc */
  onEscape?: () => void
}

/**
 * 添加任务的输入框：识别出来的日期、#项目、@标签、!优先级在输入框里高亮；
 * 输入 # 或 @ 时弹出已有的项目、标签供选择（上下方向键选，回车或 Tab 确认，Esc 关掉；
 * 名字已经输完整时回车直接提交）。
 *
 * 高亮的做法：输入框的文字设成透明，下面垫一层同样排版的文字，在那一层上给识别出来的部分加底色，
 * 横向滚动时两层一起滚
 */
export function TaskInput({
  state,
  label,
  placeholder,
  inputRef,
  autoFocus,
  className,
  onEscape,
}: TaskInputProps) {
  const { t } = useTranslation()
  const { text, setText, parsed, projects, labels } = state
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const mirrorRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [caret, setCaret] = useState(0)
  // 按 Esc 关掉的那一个（到 # 或 @ 为止的文字）：接着输入也不再弹出；
  // 不在输入 # 或 @ 时就忘掉，下一次输入 # 或 @ 照常弹出
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [highlight, setHighlight] = useState({ key: '', index: 0 })
  const nextCaret = useRef<number | null>(null)

  const trigger = findTrigger(text, caret)
  const triggerKey = trigger ? text.slice(0, trigger.start + 1) : null
  const options = trigger
    ? suggestionsFor(trigger, trigger.kind === 'project' ? projects : labels)
    : []
  const open = !!trigger && options.length > 0 && dismissed !== triggerKey
  // 换了一组候选时回到第一个
  const optionsKey = trigger ? `${trigger.start}:${trigger.query}` : ''
  const active = highlight.key === optionsKey ? highlight.index : 0

  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    // 选中候选后把光标放到插入的名字后面
    if (nextCaret.current !== null) {
      input.setSelectionRange(nextCaret.current, nextCaret.current)
      nextCaret.current = null
    }
    if (mirrorRef.current) mirrorRef.current.scrollLeft = input.scrollLeft
  })

  const choose = (name: string) => {
    if (!trigger) return
    const before = `${text.slice(0, trigger.start)}${trigger.kind === 'project' ? '#' : '@'}${name}`
    let after = text.slice(caret)
    // 光标在名字中间（#wo|rk）：光标后面那半个词也是这个名字里的，一起换掉
    const rest = /^[^\s#＃@＠!！]*/.exec(after)![0]
    if (name.toLowerCase().includes((trigger.query + rest).toLowerCase())) {
      after = after.slice(rest.length)
    }
    setText(`${before}${after.startsWith(' ') ? '' : ' '}${after}`)
    nextCaret.current = before.length + 1
    setCaret(before.length + 1)
  }

  const segments: ReactNode[] = []
  let at = 0
  for (const token of parsed.tokens) {
    segments.push(text.slice(at, token.start))
    segments.push(
      <mark
        key={token.start}
        className="rounded-[3px] bg-sky-500/15 text-sky-800 dark:bg-sky-400/20 dark:text-sky-200"
      >
        {text.slice(token.start, token.end)}
      </mark>,
    )
    at = token.end
  }
  segments.push(text.slice(at))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setDismissed(triggerKey)
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn('relative min-w-0', className)}>
          <div
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-lg border border-transparent px-2.5 py-1 text-base whitespace-pre md:text-sm"
          >
            <span>{segments}</span>
          </div>
          <Input
            ref={ref}
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            placeholder={placeholder}
            value={text}
            maxLength={500}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            className="relative text-transparent caret-foreground selection:bg-primary/20 selection:text-transparent"
            onChange={(e) => {
              if (!trigger) setDismissed(null)
              setText(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onKeyDown={(e) => {
              // 输入法正在组字时的回车、方向键是给输入法的
              if (e.nativeEvent.isComposing) return
              if (open) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : -1
                  const index = (active + step + options.length) % options.length
                  setHighlight({ key: optionsKey, index })
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  const option = options[active]
                  // 名字已经输完整了：回车直接提交
                  if (
                    e.key === 'Enter' &&
                    option.name.toLowerCase() === trigger.query.toLowerCase()
                  ) {
                    return
                  }
                  e.preventDefault()
                  choose(option.name)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setDismissed(triggerKey)
                }
                return
              }
              if (e.key === 'Escape') onEscape?.()
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-64 gap-0 p-1"
        // 焦点一直留在输入框里
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === ref.current) e.preventDefault()
        }}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger?.kind === 'label' ? t('nav.labels') : t('nav.projects')}
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 aria-selected:bg-accent aria-selected:text-accent-foreground"
              // 不让输入框失去焦点
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setHighlight({ key: optionsKey, index })}
              onClick={() => choose(option.name)}
            >
              <OptionIcon kind={trigger!.kind} item={option} />
              <span className="truncate">{option.name}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function OptionIcon({ kind, item }: { kind: Trigger['kind']; item: Item }) {
  if (kind === 'label') return <LabelIcon color={item.color} />
  if (item.is_inbox) return <Inbox aria-hidden className="size-4 text-muted-foreground" />
  return <ProjectDot color={item.color} className="mx-[3px]" />
}

/** 输入框下面列出识别出来的内容，每一项都可以取消 */
export function TokenChips({ state, className }: { state: TaskInputState; className?: string }) {
  const { t, i18n } = useTranslation()
  const today = useToday()
  const { parsed, projects, labels, ignore } = state
  if (parsed.tokens.length === 0) return null

  const describe = (token: Token): ReactNode => {
    switch (token.kind) {
      case 'date':
        return (
          <>
            <CalendarDays aria-hidden className="size-3.5" />
            {parsed.due && describeDue(parsed.due, today, t, i18n.language)?.text}
          </>
        )
      case 'project': {
        const project = projects.find((p) => p.id === token.id)
        return (
          project && (
            <>
              <OptionIcon kind="project" item={project} />
              {project.name}
            </>
          )
        )
      }
      case 'label': {
        const label = labels.find((l) => l.id === token.id)
        return (
          label && (
            <>
              <LabelIcon color={label.color} className="size-3.5" />
              {label.name}
            </>
          )
        )
      }
      case 'priority': {
        const priority = Number(token.text.slice(2)) as (typeof PRIORITIES)[number]
        return (
          <>
            <Flag aria-hidden className={cn('size-3.5', PRIORITY_TEXT_CLASS[priority])} />
            {t(`tasks.priority.p${priority}`)}
          </>
        )
      }
    }
  }

  return (
    <ul aria-label={t('quickAdd.recognized')} className={cn('flex flex-wrap gap-1.5', className)}>
      {parsed.tokens.map((token) => (
        <li
          key={token.start}
          className="flex h-6 items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 text-xs text-foreground"
        >
          {describe(token)}
          <button
            type="button"
            aria-label={t('quickAdd.ignore', { text: token.text })}
            title={t('quickAdd.ignore', { text: token.text })}
            className="rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => ignore(token)}
          >
            <X aria-hidden className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  )
}
