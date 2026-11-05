/**
 * 快速添加的解析：从一行输入里识别出截止日期、#项目、@标签、!优先级，剩下的是任务名称。
 *
 * - 日期用 chrono-node：输入里有中文时先用中文解析器，没识别出来再用英文的。另外补了几个
 *   chrono 不认识的中文说法（周末、下周、5号、下个月5号、月底）
 * - #项目、@标签只识别已有的（按名字最长匹配，不区分大小写），后面要跟着空格、标点或者结尾；
 *   前面要是开头、空格或者中文（所以 a@b.com、C# 不算）
 * - 用户可以取消某一段的识别（ignored），那一段就当作普通文字留在任务名称里
 * - 日期按用户时区里的「现在」理解，结果是日历日期和几点几分，和浏览器所在的时区无关
 */
import * as chrono from 'chrono-node'

import {
  addDays,
  daysInMonth,
  fromLocalDate,
  nextMonday,
  toLocalDate,
  weekdayOf,
} from '@/lib/dates'

type TokenKind = 'date' | 'project' | 'label' | 'priority'

/** 识别出来的一段：在输入里的位置 [start, end) */
export interface Token {
  kind: TokenKind
  start: number
  end: number
  text: string
  /** 项目、标签的 id */
  id?: string
}

/** 取消识别时记下的标识：输入改动后，同一段文字还是保持取消 */
export const tokenKey = (token: Pick<Token, 'kind' | 'text'>) => `${token.kind}:${token.text}`

interface Named {
  id: string
  name: string
}

export interface ParseOptions {
  /** 用户时区里现在的日期（YYYY-MM-DD）和时间（HH:mm） */
  now: { date: string; time: string }
  /** 可以用 # 指定的项目；为空时不识别项目（例如添加子任务） */
  projects: Named[]
  labels: Named[]
  /** 取消识别的片段（tokenKey） */
  ignored?: ReadonlySet<string>
}

export interface ParsedTask {
  /** 去掉识别出来的片段后的任务名称 */
  title: string
  /** 按位置排列 */
  tokens: Token[]
  due?: { due_date: string; due_time: string | null }
  projectId?: string
  labelIds: string[]
  priority?: number
}

const CJK = /[㐀-鿿豈-﫿]/
const SYMBOL_KIND: Record<string, 'project' | 'label' | 'priority'> = {
  '#': 'project',
  '＃': 'project',
  '@': 'label',
  '＠': 'label',
  '!': 'priority',
  '！': 'priority',
}
// 名字后面可以跟的字符：空格、标点、下一个 # @ !
const AFTER = /[\s#＃@＠!！,，.。;；:：?？、)）]/

const boundaryBefore = (text: string, i: number) =>
  i === 0 || /\s/.test(text[i - 1]) || CJK.test(text[i - 1])
const boundaryAfter = (text: string, j: number) => j >= text.length || AFTER.test(text[j])

/** 在 text 的 at 位置找最长的、后面是边界的名字 */
function matchName<T extends Named>(text: string, at: number, items: T[]): T | undefined {
  let best: T | undefined
  for (const item of items) {
    const end = at + item.name.length
    // 按原来的长度截取再比较：有的字转小写后长度会变（İ → i̇）
    if (
      item.name &&
      text.slice(at, end).toLowerCase() === item.name.toLowerCase() &&
      boundaryAfter(text, end) &&
      (!best || item.name.length > best.name.length)
    ) {
      best = item
    }
  }
  return best
}

/** 符号开头的部分：#项目、@标签、!p1 */
function symbolTokens(text: string, options: ParseOptions) {
  const tokens: Token[] = []
  let projectId: string | undefined
  let priority: number | undefined
  const labelIds: string[] = []

  for (let i = 0; i < text.length; i++) {
    const kind = SYMBOL_KIND[text[i]]
    if (!kind || !boundaryBefore(text, i)) continue
    // 项目和优先级只认第一个，标签可以有多个
    let end = -1
    let item: Named | undefined
    if (kind === 'priority') {
      const p1to4 = /^p[1-4]$/i.test(text.slice(i + 1, i + 3))
      if (priority === undefined && p1to4 && boundaryAfter(text, i + 3)) end = i + 3
    } else if (kind === 'label' || projectId === undefined) {
      item = matchName(text, i + 1, kind === 'project' ? options.projects : options.labels)
      if (item) end = i + 1 + item.name.length
    }
    if (end < 0) continue
    const token: Token = {
      kind,
      start: i,
      end,
      text: text.slice(i, end),
      ...(item && { id: item.id }),
    }
    if (options.ignored?.has(tokenKey(token))) continue
    tokens.push(token)
    if (kind === 'priority') priority = Number(text[i + 2])
    else if (kind === 'project') projectId = item?.id
    else if (item && !labelIds.includes(item.id)) labelIds.push(item.id)
    i = end - 1
  }
  return { tokens, projectId, priority, labelIds }
}

/** 正在输入的 #项目 或 @标签（光标前面）：用来显示候选列表 */
export interface Trigger {
  kind: 'project' | 'label'
  /** # 或 @ 所在的位置 */
  start: number
  /** # 或 @ 和光标之间的文字 */
  query: string
}

export function findTrigger(text: string, caret: number): Trigger | null {
  for (let i = caret - 1; i >= 0 && !/\s/.test(text[i]); i--) {
    const kind = SYMBOL_KIND[text[i]]
    if (kind === 'priority') return null
    if (kind) {
      return boundaryBefore(text, i) ? { kind, start: i, query: text.slice(i + 1, caret) } : null
    }
  }
  return null
}

// ---------- 日期 ----------

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const parts = (date: string) => date.split('-').map(Number) as [number, number, number]
const dateComponents = (date: string) => {
  const [year, month, day] = parts(date)
  return { year, month, day }
}

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const DAY_NUMBER = '(\\d{1,2}|[一二三]?十[一二三四五六七八九]?|[一二三四五六七八九])'
/** 1–31 的阿拉伯数字或中文数字 */
function dayNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text)
  if (!text.includes('十')) return CN_DIGIT[text] ?? 0
  const [tens, ones] = text.split('十')
  return (tens ? CN_DIGIT[tens] : 1) * 10 + (ones ? CN_DIGIT[ones] : 0)
}

const nextMonth = (year: number, month: number) =>
  (month === 12 ? [year + 1, 1] : [year, month + 1]) as [number, number]

/** 下一个 day 号（今天或以后；这个月没有这一天就跳过这个月） */
function nextDayOfMonth(today: string, day: number): string | null {
  if (day < 1 || day > 31) return null
  let [year, month] = parts(today)
  for (let i = 0; i < 12; i++) {
    if (day <= daysInMonth(year, month)) {
      const date = isoDate(year, month, day)
      if (date >= today) return date
    }
    ;[year, month] = nextMonth(year, month)
  }
  return null
}

/** 即将到来的周六（今天是周六就是今天） */
const comingSaturday = (today: string) => addDays(today, (6 - weekdayOf(today) + 7) % 7)

/** chrono 的中文解析器不认识的说法 */
const zhExtras: chrono.Parser[] = [
  {
    // 下周末（放在「下周」前面）
    pattern: () => /下个?(?:周|星期|礼拜)末/,
    extract: (context) => dateComponents(addDays(nextMonday(fromLocalDate(context.refDate)), 5)),
  },
  {
    // 下周（后面没有跟着星期几）：下周一
    pattern: () => /下个?(?:周|星期|礼拜)(?![一二三四五六日天末1-7])/,
    extract: (context) => dateComponents(nextMonday(fromLocalDate(context.refDate))),
  },
  {
    pattern: () => /(?:这个?|本)?(?:周|星期|礼拜)末/,
    extract: (context) => dateComponents(comingSaturday(fromLocalDate(context.refDate))),
  },
  {
    // 月底、下个月底
    pattern: () => /(下个?|这个?|本)?月[底末]/,
    extract: (context, match) => {
      let [year, month] = parts(fromLocalDate(context.refDate))
      if (match[1]?.startsWith('下')) [year, month] = nextMonth(year, month)
      return { year, month, day: daysInMonth(year, month) }
    },
  },
  {
    pattern: () => new RegExp(`下个?月${DAY_NUMBER}[号日]`),
    extract: (context, match) => {
      const [thisYear, thisMonth] = parts(fromLocalDate(context.refDate))
      const [year, month] = nextMonth(thisYear, thisMonth)
      const day = dayNumber(match[1])
      return day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null
    },
  },
  {
    // 单独的「5号」：下一个 5 号。「11月5号」由 chrono 自己处理；「5号线」「5号电池」不是日期。
    // 前一个字在 extract 里看，不能用 lookbehind：这里返回 null 时 chrono 会从下一个字开始重新匹配
    // （「42号」再去匹配「2号」），那时正则已经看不到前面的字了
    pattern: () => new RegExp(`${DAY_NUMBER}[号日](?![\\d线楼门床房位电池])`),
    extract: (context, match) => {
      if (/[\d月一二三四五六七八九十]/.test(context.text[(match.index ?? 0) - 1] ?? '')) return null
      const date = nextDayOfMonth(fromLocalDate(context.refDate), dayNumber(match[1]))
      return date ? dateComponents(date) : null
    },
  },
]

const zhParser = chrono.zh.hans.casual.clone()
zhParser.parsers.push(...zhExtras)
const enParser = chrono.en.casual

// 单独出现时不当作日期：「订下午茶」「一下午」；英文的星期、月份缩写（sun cream、sat on）和 now
const ZH_BARE = /^(?:上午|下午|中午|晚上|早上|早晨|凌晨|傍晚|夜里|夜晚|午后|白天)$/
const EN_BARE =
  /^(?:now|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)$/i

/** chrono 的一段结果去掉前后空白后的位置 */
function span(result: chrono.ParsedResult) {
  const text = result.text.trim()
  const start = result.index + result.text.indexOf(text)
  return text ? { text, start, end: start + text.length } : null
}

const MASK = '\u0000'

function dateToken(masked: string, options: ParseOptions) {
  // chrono 的参照时间是本地时区的 Date：用用户时区里的年月日、时分构造（parser 里用 fromLocalDate 取回年月日）
  const [hour, minute] = options.now.time.split(':').map(Number)
  const ref = toLocalDate(options.now.date)
  ref.setHours(hour, minute)
  const parsers = CJK.test(masked) ? [zhParser, enParser] : [enParser]

  for (const parser of parsers) {
    const results = parser.parse(masked, ref, { forwardDate: true })
    for (const [i, result] of results.entries()) {
      const found = span(result)
      if (!found || ZH_BARE.test(found.text) || EN_BARE.test(found.text)) continue
      const { start } = found
      let end = found.end
      // 日期、时间、星期几从哪一段取（next week friday 取后一段）
      let s = result.start
      // 紧跟着的下一段（中间只有空白）
      const following = results[i + 1]
      const next = following && span(following)
      const adjacent = !!next && !masked.slice(end, next.start).trim()
      // 「下周五下午」「11月20日下午」：chrono 拆成了两段，后面的「下午」也算进日期里（不带时间）
      if (adjacent && ZH_BARE.test(next.text)) end = next.end
      // next week：chrono 给的是 7 天后，这里和「下周」、日期选择器一样当作下周一（next week 3pm 带着时间）。
      // 后面紧跟着星期几时（next week friday、next week on tuesday 3pm），chrono 拆成两段，
      // 后一段是「这个」星期几：合起来是下周的那一天，时间用后一段的
      const nextWeek = /\bnext\s+week\b/i.test(found.text) && !s.isCertain('weekday')
      const thenWeekday = nextWeek && adjacent && following.start.isCertain('weekday')
      if (thenWeekday) {
        end = next.end
        s = following.start
      }
      const token: Token = { kind: 'date', start, end, text: masked.slice(start, end) }
      if (options.ignored?.has(tokenKey(token))) continue
      let due_date = isoDate(s.get('year')!, s.get('month')!, s.get('day')!)
      const weekday = s.get('weekday')
      if (nextWeek) {
        // chrono 的星期几从周日（0）算起
        due_date = addDays(nextMonday(options.now.date), thenWeekday ? (weekday! + 6) % 7 : 0)
      } else if (s.isCertain('weekday') && weekday !== null && weekday !== weekdayOf(due_date)) {
        // 「周五下午」：chrono 把「下午」当成今天下午，合并后日期成了今天。以星期几为准，往后找那一天
        due_date = addDays(due_date, (weekday - weekdayOf(due_date) + 7) % 7)
      }
      const due_time = s.isCertain('hour')
        ? `${pad(s.get('hour')!)}:${pad(s.get('minute') ?? 0)}:00`
        : null
      return { token, due: { due_date, due_time } }
    }
  }
  return null
}

export function parseTask(text: string, options: ParseOptions): ParsedTask {
  const symbols = symbolTokens(text, options)
  // 日期在剩下的文字里找：#项目、@标签 的名字里可能有像日期的字。
  // 遮住的地方不用空格：chrono 会把空格两边的「明天」和「下午3点」合成一段，跨过 #项目
  let masked = text
  for (const token of symbols.tokens) {
    masked =
      masked.slice(0, token.start) + MASK.repeat(token.end - token.start) + masked.slice(token.end)
  }
  const date = dateToken(masked, options)

  const tokens = [...symbols.tokens, ...(date ? [date.token] : [])].sort(
    (a, b) => a.start - b.start,
  )
  let title = ''
  let at = 0
  for (const token of tokens) {
    title += `${text.slice(at, token.start)} `
    at = token.end
  }
  title = (title + text.slice(at)).replace(/\s+/g, ' ').trim()

  return {
    title,
    tokens,
    due: date?.due,
    projectId: symbols.projectId,
    labelIds: symbols.labelIds,
    priority: symbols.priority,
  }
}
