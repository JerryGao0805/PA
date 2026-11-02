import i18n from '@/i18n'
import { describeDue } from '@/features/tasks/due'

import { addDays, daysBetween, formatMonthDay, nextMonday, relativeDay, todayIn } from './dates'

test('todayIn：同一时刻在不同时区是不同的日期', () => {
  const now = new Date('2026-11-01T20:30:00Z')
  expect(todayIn('UTC', now)).toBe('2026-11-01')
  expect(todayIn('Asia/Shanghai', now)).toBe('2026-11-02') // UTC+8，已经过了午夜
  expect(todayIn('America/Los_Angeles', now)).toBe('2026-11-01')
  // 无效的时区名退回 UTC
  expect(todayIn('Not/AZone', now)).toBe('2026-11-01')
})

test('todayIn：夏令时切换当天也正确', () => {
  // 2026-11-01 是美国结束夏令时的日子，凌晨 2 点回拨到 1 点
  expect(todayIn('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01')
  expect(todayIn('America/New_York', new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01')
  expect(todayIn('America/New_York', new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02')
})

test('addDays / daysBetween：跨月、跨年、闰年', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7)
  expect(daysBetween('2026-11-01', '2026-10-25')).toBe(-7)
  // 夏令时切换不影响天数
  expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
})

test('nextMonday：今天是周一时是下周一', () => {
  expect(nextMonday('2026-11-01')).toBe('2026-11-02') // 周日
  expect(nextMonday('2026-11-02')).toBe('2026-11-09') // 周一
  expect(nextMonday('2026-11-07')).toBe('2026-11-09') // 周六
})

test('relativeDay 和 formatMonthDay', () => {
  expect(relativeDay('2026-10-31', '2026-11-01')).toBe('yesterday')
  expect(relativeDay('2026-11-01', '2026-11-01')).toBe('today')
  expect(relativeDay('2026-11-02', '2026-11-01')).toBe('tomorrow')
  expect(relativeDay('2026-11-03', '2026-11-01')).toBeNull()
  expect(formatMonthDay('2026-11-03', '2026-11-01', 'zh-CN')).toBe('11月3日')
  expect(formatMonthDay('2027-01-03', '2026-11-01', 'zh-CN')).toBe('2027年1月3日')
})

test('describeDue：截止日期的写法和颜色', () => {
  const today = '2026-11-01'
  const due = (due_date: string | null, due_time: string | null = null) =>
    describeDue({ due_date, due_time }, today, i18n.t, 'zh-CN')

  expect(due(null)).toBeNull()
  expect(due('2026-10-31')).toEqual({ text: '昨天', tone: 'overdue' })
  expect(due('2026-10-20')).toEqual({ text: '10月20日', tone: 'overdue' })
  expect(due('2026-11-01', '09:05:00')).toEqual({ text: '今天 09:05', tone: 'today' })
  expect(due('2026-11-02')).toEqual({ text: '明天', tone: 'soon' })
  expect(due('2026-11-04')).toEqual({ text: '周三', tone: 'soon' })
  expect(due('2026-11-08')).toEqual({ text: '11月8日', tone: 'later' })
})
