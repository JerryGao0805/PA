import type { ReactNode } from 'react'

export function PageHeader({
  title,
  icon,
  subtitle,
  actions,
}: {
  title: string
  icon?: ReactNode
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="grid gap-1">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </header>
  )
}

/** 列表里的分组标题，例如「已逾期」「11月2日 · 明天」 */
export function SectionHeading({
  id,
  children,
  count,
}: {
  id: string
  children: ReactNode
  count?: number
}) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 text-sm font-semibold">
      {children}
      {count !== undefined && (
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      )}
    </h2>
  )
}
