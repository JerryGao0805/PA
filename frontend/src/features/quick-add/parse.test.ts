import { findTrigger, parseTask, tokenKey, type ParseOptions } from './parse'

// 2026-11-04 是周三，用户时区里的下午两点
const now = { date: '2026-11-04', time: '14:00' }
const projects = [
  { id: 'inbox', name: '收件箱' },
  { id: 'work', name: '工作' },
  { id: 'weekly', name: '工作周报' },
  { id: 'personal', name: '个人 项目' },
  { id: 'side', name: 'Side Project' },
  { id: 'plan', name: '下周计划' },
]
const labels = [
  { id: 'important', name: '重要' },
  { id: 'urgent', name: '紧急' },
  { id: 'home', name: 'home' },
]
const options: ParseOptions = { now, projects, labels }
const parse = (text: string, extra: Partial<ParseOptions> = {}) =>
  parseTask(text, { ...options, ...extra })

test('一句话里的日期、项目、标签和优先级', () => {
  const parsed = parse('明天下午3点 交报告 #工作 @重要 !p1')
  expect(parsed).toMatchObject({
    title: '交报告',
    due: { due_date: '2026-11-05', due_time: '15:00:00' },
    projectId: 'work',
    labelIds: ['important'],
    priority: 1,
  })
  expect(parsed.tokens).toEqual([
    { kind: 'date', start: 0, end: 6, text: '明天下午3点' },
    { kind: 'project', start: 11, end: 14, text: '#工作', id: 'work' },
    { kind: 'label', start: 15, end: 18, text: '@重要', id: 'important' },
    { kind: 'priority', start: 19, end: 22, text: '!p1' },
  ])
})

test('没有可识别的内容时原样作为名称', () => {
  expect(parse('交报告')).toEqual({ title: '交报告', tokens: [], labelIds: [] })
})

describe('日期', () => {
  test.each([
    ['今天 交电费', '2026-11-04', null, '交电费'],
    ['后天 买菜', '2026-11-06', null, '买菜'],
    ['大后天 出差', '2026-11-07', null, '出差'],
    ['周五 交周报', '2026-11-06', null, '交周报'],
    ['下周一 开会', '2026-11-09', null, '开会'],
    ['下周五', '2026-11-13', null, ''],
    ['11月20日 体检', '2026-11-20', null, '体检'],
    ['12月1号 交房租', '2026-12-01', null, '交房租'],
    ['1月3日 生日', '2027-01-03', null, '生日'],
    ['3天后 复查', '2026-11-07', null, '复查'],
    ['今晚 跑步', '2026-11-04', null, '跑步'],
    ['今晚8点 跑步', '2026-11-04', '20:00:00', '跑步'],
    ['明早9点半 面试', '2026-11-05', '09:30:00', '面试'],
    ['明天15:30 开会', '2026-11-05', '15:30:00', '开会'],
    ['下午三点 打电话', '2026-11-04', '15:00:00', '打电话'],
    // 今天的这个时间已经过了：明天
    ['上午10点 开会', '2026-11-05', '10:00:00', '开会'],
    ['写周报 周五下午5点', '2026-11-06', '17:00:00', '写周报'],
    ['明天下午3点交报告', '2026-11-05', '15:00:00', '交报告'],
    // 星期几后面只跟着「下午」「晚上」：日期按星期几算，不带时间
    ['周五下午 开会', '2026-11-06', null, '开会'],
    ['星期五晚上 聚餐', '2026-11-06', null, '聚餐'],
    ['周一下午 开会', '2026-11-09', null, '开会'],
    ['周三下午 开会', '2026-11-04', null, '开会'],
    ['下周五下午 开会', '2026-11-13', null, '开会'],
    ['11月20日下午 体检', '2026-11-20', null, '体检'],
  ])('%s', (text, due_date, due_time, title) => {
    expect(parse(text)).toMatchObject({ title, due: { due_date, due_time } })
  })

  test.each([
    ['周末 大扫除', '2026-11-07', '大扫除'],
    ['这周末 大扫除', '2026-11-07', '大扫除'],
    ['下周末 爬山', '2026-11-14', '爬山'],
    // 和日期选择器里的「下周」一样是下周一
    ['下周 写总结', '2026-11-09', '写总结'],
    ['月底 交报告', '2026-11-30', '交报告'],
    ['下个月底 交报告', '2026-12-31', '交报告'],
    ['下月底 交报告', '2026-12-31', '交报告'],
    ['5号 交房租', '2026-11-05', '交房租'],
    // 这个月的 3 号已经过了
    ['3号 交房租', '2026-12-03', '交房租'],
    ['二十号 还信用卡', '2026-11-20', '还信用卡'],
    ['下个月5号 还信用卡', '2026-12-05', '还信用卡'],
    ['下月三十一号 交房租', '2026-12-31', '交房租'],
  ])('补充的中文说法：%s', (text, due_date, title) => {
    expect(parse(text)).toMatchObject({ title, due: { due_date } })
  })

  test('没有这一天的月份跳过', () => {
    const january = { date: '2027-01-31', time: '09:00' }
    // 2 月没有 31 号：下个月 31 号不是日期；单独的「31号」是 3 月 31 日
    expect(parse('下个月31号 交房租', { now: january }).due).toBeUndefined()
    expect(parse('31号 交房租', { now: { date: '2027-02-01', time: '09:00' } }).due).toEqual({
      due_date: '2027-03-31',
      due_time: null,
    })
  })

  test('12 月里说「下个月」是明年 1 月', () => {
    const december = { now: { date: '2026-12-10', time: '09:00' } }
    expect(parse('下个月底', december).due?.due_date).toBe('2027-01-31')
    expect(parse('下个月5号', december).due?.due_date).toBe('2027-01-05')
  })

  test('「5号下午3点」带上时间', () => {
    expect(parse('5号下午3点 开会').due).toEqual({ due_date: '2026-11-05', due_time: '15:00:00' })
  })

  test.each([
    ['tomorrow 3pm submit report', '2026-11-05', '15:00:00', 'submit report'],
    ['buy milk friday', '2026-11-06', null, 'buy milk'],
    ['next monday meeting', '2026-11-09', null, 'meeting'],
    ['next week review', '2026-11-09', null, 'review'],
    ['in 3 days review', '2026-11-07', null, 'review'],
    ['call mom tonight', '2026-11-04', null, 'call mom'],
  ])('英文：%s', (text, due_date, due_time, title) => {
    expect(parse(text)).toMatchObject({ title, due: { due_date, due_time } })
  })

  test('中英混合：先用中文解析器', () => {
    expect(parse('明天 call John')).toMatchObject({
      title: 'call John',
      due: { due_date: '2026-11-05', due_time: null },
    })
  })

  test.each([
    '订下午茶',
    '一下午都在写代码',
    '买3个苹果',
    '买5号电池',
    '坐3号线去公司',
    // 超过 31 的数字不是几号，后面几位也不能单独算
    '买42号鞋',
    '三十二号 交报告',
    'sun cream',
    'sat on the chair',
    'read 2 books',
  ])('不是日期：%s', (text) => {
    const parsed = parse(text)
    expect(parsed.due).toBeUndefined()
    expect(parsed.title).toBe(text)
  })

  test('只取第一个日期，后面的留在名称里', () => {
    expect(parse('明天 准备后天的会')).toMatchObject({
      title: '准备后天的会',
      due: { due_date: '2026-11-05' },
    })
  })
})

describe('#项目、@标签、!优先级', () => {
  test('名字可以带空格，按最长的匹配，不区分大小写', () => {
    expect(parse('#个人 项目 买书')).toMatchObject({ title: '买书', projectId: 'personal' })
    expect(parse('#工作周报 写')).toMatchObject({ title: '写', projectId: 'weekly' })
    expect(parse('#side project demo')).toMatchObject({ title: 'demo', projectId: 'side' })
    expect(parse('#收件箱 随便记一下')).toMatchObject({ projectId: 'inbox' })
  })

  test('转小写后长度会变的名字', () => {
    const istanbul = [{ id: 'ist', name: 'İstanbul' }]
    expect(parse('#İstanbul 订酒店', { projects: istanbul })).toMatchObject({
      title: '订酒店',
      projectId: 'ist',
    })
  })

  test('日期不会跨过 #项目 和后面的文字连在一起', () => {
    const parsed = parse('明天 #工作 下午3点 开会')
    expect(parsed.tokens.map((t) => t.text)).toEqual(['明天', '#工作'])
    expect(parsed.title).toBe('下午3点 开会')
  })

  test('名字后面要是空格、标点或者结尾', () => {
    // 没有叫「工作汇报」的项目，「工作」后面紧跟着别的字不算
    expect(parse('#工作汇报')).toEqual({ title: '#工作汇报', tokens: [], labelIds: [] })
    expect(parse('写报告 #工作，今天')).toMatchObject({ projectId: 'work' })
    expect(parse('#不存在的项目 写')).toMatchObject({ title: '#不存在的项目 写', tokens: [] })
  })

  test('前面要是开头、空格或者中文', () => {
    expect(parse('交报告#工作')).toMatchObject({ title: '交报告', projectId: 'work' })
    expect(parse('写!p1')).toMatchObject({ title: '写', priority: 1 })
    expect(parse('mail me@home now')).toMatchObject({ title: 'mail me@home now', labelIds: [] })
    expect(parse('学 C#工作')).toMatchObject({ title: '学 C#工作', projectId: undefined })
    expect(parse('wow!p1')).toMatchObject({ title: 'wow!p1', priority: undefined })
  })

  test('全角符号也可以', () => {
    expect(parse('＃工作 ＠重要 ！p2 写')).toMatchObject({
      title: '写',
      projectId: 'work',
      labelIds: ['important'],
      priority: 2,
    })
  })

  test('标签可以有多个；项目和优先级只认第一个', () => {
    expect(parse('@重要 @紧急 @重要 写')).toMatchObject({
      title: '写',
      labelIds: ['important', 'urgent'],
    })
    expect(parse('#工作 #个人 项目 写 !p2 !p1')).toMatchObject({
      title: '#个人 项目 写 !p1',
      projectId: 'work',
      priority: 2,
    })
  })

  test('优先级只有 p1–p4，大小写都行', () => {
    expect(parse('!P3 写')).toMatchObject({ priority: 3 })
    expect(parse('!p5 写')).toMatchObject({ title: '!p5 写', priority: undefined })
    expect(parse('!p12 写')).toMatchObject({ priority: undefined })
  })

  test('项目名里像日期的字不当作日期', () => {
    expect(parse('#下周计划 整理')).toMatchObject({ title: '整理', projectId: 'plan' })
    expect(parse('#下周计划 整理').due).toBeUndefined()
  })

  test('不能指定项目时（子任务）# 当作普通文字', () => {
    expect(parse('#工作 写', { projects: [] })).toMatchObject({
      title: '#工作 写',
      projectId: undefined,
    })
  })
})

describe('取消识别', () => {
  test('取消的片段留在名称里', () => {
    const ignored = new Set([tokenKey({ kind: 'date', text: '明天' })])
    expect(parse('明天 交报告', { ignored })).toEqual({
      title: '明天 交报告',
      tokens: [],
      labelIds: [],
    })
  })

  test('只取消这一种：同样的文字作为别的种类不受影响', () => {
    const ignored = new Set([tokenKey({ kind: 'project', text: '#工作' })])
    expect(parse('#工作 @重要 写', { ignored })).toMatchObject({
      title: '#工作 写',
      projectId: undefined,
      labelIds: ['important'],
    })
  })
})

test('名称里多余的空格合并掉', () => {
  expect(parse('  交   报告  明天 ').title).toBe('交 报告')
})

test('正在输入的 #项目、@标签', () => {
  expect(findTrigger('写 #工', 4)).toEqual({ kind: 'project', start: 2, query: '工' })
  expect(findTrigger('写 #', 3)).toEqual({ kind: 'project', start: 2, query: '' })
  expect(findTrigger('交报告@重', 5)).toEqual({ kind: 'label', start: 3, query: '重' })
  // 光标在中间：只看光标前面
  expect(findTrigger('写 @重要 明天', 4)).toEqual({ kind: 'label', start: 2, query: '重' })
  // 已经输完（后面有空格）、在别的字后面、是优先级
  expect(findTrigger('#工作 写', 5)).toBeNull()
  expect(findTrigger('me@ho', 5)).toBeNull()
  expect(findTrigger('写 !p', 4)).toBeNull()
})
