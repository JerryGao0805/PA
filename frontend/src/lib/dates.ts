/**
 * 截止日期是日历日期（YYYY-MM-DD 字符串），按用户设置的时区理解，不随浏览器所在时区变化。
 * 这里的计算都在字符串 / UTC 上做，避免本地时区和夏令时带来的误差。
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 某个时区里的今天 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    // en-CA 的日期格式正好是 YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    // 时区名无效（理论上后端已校验）时退回 UTC
    return now.toISOString().slice(0, 10)
  }
}

/** 某个时区里现在的日期（YYYY-MM-DD）和时间（HH:mm） */
export function nowIn(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const date = todayIn(timeZone, now)
  try {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now)
    return { date, time }
  } catch {
    return { date, time: now.toISOString().slice(11, 16) }
  }
}

const toUtc = (date: string) => new Date(`${date}T00:00:00Z`)
const fromUtc = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(date: string, days: number): string {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** to 比 from 晚几天（早则为负） */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS)
}

/** 这个月有几天（month 从 1 开始） */
export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/** 0 = 周日 … 6 = 周六 */
export const weekdayOf = (date: string) => toUtc(date).getUTCDay()

/** 下一个周一（今天是周一时为下周一） */
export function nextMonday(today: string): string {
  const delta = (8 - weekdayOf(today)) % 7 || 7
  return addDays(today, delta)
}

// 日期选择器（react-day-picker）用的是本地时区的 Date 对象，只取年月日
export function toLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function fromLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 后端返回的时间形如 15:00:00，界面上只显示到分钟 */
export const formatTime = (time: string) => time.slice(0, 5)

function format(date: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(toUtc(date))
}

export const formatWeekday = (date: string, locale: string) =>
  format(date, locale, { weekday: 'short' })

/** 11月3日；不是今年时带上年份 */
export function formatMonthDay(date: string, today: string, locale: string): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return format(date, locale, {
    year: sameYear ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export type RelativeDay = 'yesterday' | 'today' | 'tomorrow'

export function relativeDay(date: string, today: string): RelativeDay | null {
  const diff = daysBetween(today, date)
  if (diff === -1) return 'yesterday'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return null
}
