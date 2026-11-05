import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  CalendarDays,
  CalendarRange,
  Circle,
  CircleCheck,
  CirclePlus,
  Inbox,
  Settings,
} from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as BaseCommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { labelsQuery } from '@/features/labels/api'
import { LabelIcon } from '@/features/labels/LabelIcon'
import { projectsQuery, type Project } from '@/features/projects/api'
import { ProjectDot } from '@/features/projects/ProjectDot'
import { useOpenQuickAdd } from '@/features/quick-add/open-quick-add'
import { isDone, searchTasksQuery, type Task } from '@/features/tasks/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'

import { isMac, OpenCommandPalette } from './open-command-palette'

/**
 * shadcn 的 CommandItem 末尾自带一个「已选中」的勾（用不到，透明但占位置），
 * 右边会空出一截：这里把它藏起来（组件文件保持原样，方便以后用 CLI 更新）
 */
function CommandItem({ className, ...props }: ComponentProps<typeof BaseCommandItem>) {
  return <BaseCommandItem className={cn('[&>svg:last-child]:hidden', className)} {...props} />
}

/** 输入停下来多久再搜索任务 */
const SEARCH_DELAY = 200
/** 关键词最长多少字：和后端 GET /tasks/search 的 max_length 一致，超了会返回 422 */
const SEARCH_MAX_LENGTH = 200

/**
 * 焦点在别的对话框里（快速添加、新建项目、删除确认……）时不打开：跳到别的页面后，
 * 它们还会留在原地，而且快速添加的默认项目、日期会变成新页面的。
 * 带 data-allows-command-palette 的除外：搜索面板自己（再按一次关闭）和任务详情
 * （跟着地址走，跳转时自然就换掉或关上了）
 */
function blocksPalette(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]')
  return !!dialog && !dialog.hasAttribute('data-allows-command-palette')
}

/** 搜索面板：在任何地方按 Cmd/Ctrl+K（或点侧边栏上的「搜索」）打开，再按一次关闭 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(isMac() ? e.metaKey : e.ctrlKey)) return
      if (e.altKey || e.shiftKey || e.isComposing || blocksPalette(e.target)) return
      // 也拦下浏览器自己的 Ctrl+K（Windows 上的 Chrome 会跳到地址栏搜索）
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <OpenCommandPalette value={() => setOpen(true)}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <CommandPalette onClose={() => setOpen(false)} />}
      </Dialog>
    </OpenCommandPalette>
  )
}

/**
 * 输入时筛选页面、项目和标签（名字里包含输入的文字），同时按标题和描述搜索任务。
 * 选中任务：跳到它所在的项目并打开详情
 */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const openQuickAdd = useOpenQuickAdd()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: labels } = useSuspenseQuery(labelsQuery)
  const [query, setQuery] = useState('')
  const q = query.trim()
  const debounced = useDebouncedValue(q, SEARCH_DELAY)
  const search = useQuery({
    ...searchTasksQuery(debounced),
    enabled: debounced !== '',
    // 输入变化时先留着上一次的结果，不闪
    placeholderData: keepPreviousData,
  })

  const matches = (name: string) => name.toLowerCase().includes(q.toLowerCase())
  const go = (run: () => void) => {
    onClose()
    run()
  }
  const projectName = (p: Project) => (p.is_inbox ? t('nav.inbox') : p.name)
  const openTask = (task: Task) => {
    const inTheInbox = projects.find((p) => p.id === task.project_id)?.is_inbox
    void navigate(
      inTheInbox
        ? { to: '/inbox', search: { task: task.id } }
        : {
            to: '/projects/$projectId',
            params: { projectId: task.project_id },
            search: { task: task.id },
          },
    )
  }

  const actions = [
    {
      id: 'quick-add',
      label: t('quickAdd.title'),
      icon: <CirclePlus />,
      shortcut: 'Q',
      run: openQuickAdd,
    },
  ].filter((a) => matches(a.label))
  const pages = [
    { id: 'inbox', label: t('nav.inbox'), icon: <Inbox />, to: '/inbox' as const },
    { id: 'today', label: t('nav.today'), icon: <CalendarDays />, to: '/today' as const },
    { id: 'upcoming', label: t('nav.upcoming'), icon: <CalendarRange />, to: '/upcoming' as const },
    { id: 'settings', label: t('nav.settings'), icon: <Settings />, to: '/settings' as const },
  ].filter((p) => matches(p.label))
  // 没输入时只列出侧边栏上的项目；输入了也能找到归档的
  const projectItems = projects.filter((p) => !p.is_inbox && (q ? matches(p.name) : !p.archived))
  const labelItems = labels.filter((l) => matches(l.name))
  // 新结果回来之前显示的是上一次的（keepPreviousData），先按现在的文字在本地筛一遍：
  // 接着往后打字时结果直接变少、不闪；换成不相关的词时旧结果就不显示，回车不会选中它们
  const fresh = debounced === q && !search.isPlaceholderData
  const tasks = !q
    ? []
    : fresh
      ? (search.data ?? [])
      : (search.data ?? []).filter((task) => matches(task.title) || matches(task.description))
  const searching = q !== '' && (debounced !== q || search.isFetching)

  return (
    <DialogContent
      data-allows-command-palette
      showCloseButton={false}
      className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
    >
      <DialogTitle className="sr-only">{t('command.title')}</DialogTitle>
      <DialogDescription className="sr-only">{t('command.description')}</DialogDescription>
      <Command shouldFilter={false} loop label={t('command.title')}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          maxLength={SEARCH_MAX_LENGTH}
          placeholder={t('command.placeholder')}
        />
        <CommandList className="max-h-[min(26rem,60vh)]">
          <CommandEmpty className="py-6 text-muted-foreground">
            {search.isError
              ? t('command.failed')
              : searching
                ? t('command.searching')
                : t('command.empty')}
          </CommandEmpty>

          {actions.length > 0 && (
            <CommandGroup heading={t('command.actions')}>
              {actions.map((a) => (
                <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => go(a.run)}>
                  {a.icon}
                  {a.label}
                  <CommandShortcut>{a.shortcut}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {pages.length > 0 && (
            <CommandGroup heading={t('command.goTo')}>
              {pages.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`page:${p.id}`}
                  onSelect={() => go(() => void navigate({ to: p.to }))}
                >
                  {p.icon}
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {projectItems.length > 0 && (
            <CommandGroup heading={t('nav.projects')}>
              {projectItems.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`project:${p.id}`}
                  onSelect={() =>
                    go(
                      () =>
                        void navigate({ to: '/projects/$projectId', params: { projectId: p.id } }),
                    )
                  }
                >
                  <ProjectDot color={p.color} className="mx-[3px]" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.archived && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('nav.archived')}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {labelItems.length > 0 && (
            <CommandGroup heading={t('nav.labels')}>
              {labelItems.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`label:${l.id}`}
                  onSelect={() =>
                    go(() => void navigate({ to: '/labels/$labelId', params: { labelId: l.id } }))
                  }
                >
                  <LabelIcon color={l.color} />
                  <span className="truncate">{l.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {tasks.length > 0 && (
            <CommandGroup heading={t('command.tasks')}>
              {tasks.map((task) => {
                const project = projects.find((p) => p.id === task.project_id)
                return (
                  <CommandItem
                    key={task.id}
                    value={`task:${task.id}`}
                    onSelect={() => go(() => openTask(task))}
                  >
                    {isDone(task) ? (
                      <CircleCheck className="text-muted-foreground" />
                    ) : (
                      <Circle className="text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        'flex-1 truncate',
                        isDone(task) && 'text-muted-foreground line-through',
                      )}
                    >
                      {task.title}
                    </span>
                    {project && (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {project.is_inbox ? (
                          <Inbox className="size-3.5" />
                        ) : (
                          <ProjectDot color={project.color} />
                        )}
                        {projectName(project)}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </DialogContent>
  )
}
