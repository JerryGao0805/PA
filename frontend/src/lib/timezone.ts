/** 浏览器所在的时区（IANA 名字，例如 Asia/Shanghai）；取不到时是 UTC */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * 可选的时区：浏览器认识的所有 IANA 时区，按名字排序。
 * 再加上 UTC 和当前设置的那个：浏览器的列表里不一定有（例如 Chrome 的列表里没有 UTC）
 */
export function timezoneOptions(current: string): string[] {
  return [...new Set(['UTC', current, ...Intl.supportedValuesOf('timeZone')])].sort()
}

/** 这个时区现在和 UTC 差多少，例如「UTC+8」「UTC-5」「UTC」（夏令时期间和冬天不一样） */
export function utcOffset(timeZone: string, at = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    return name?.replace('GMT', 'UTC') ?? ''
  } catch {
    return ''
  }
}

/** 列表里显示的名字：下划线换成空格（America/New_York → America/New York） */
export const timezoneLabel = (timeZone: string) => timeZone.replaceAll('_', ' ')
