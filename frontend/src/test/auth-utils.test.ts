import { ApiError, errorMessage, unwrap } from '@/lib/api-error'
import { safeRedirect, tokenFromHash } from '@/features/auth/redirect'
import i18n from '@/i18n'

test.each([
  ['/', '/'],
  ['/projects/1?view=board', '/projects/1?view=board'],
  ['https://evil.example', '/'],
  ['//evil.example', '/'],
  ['/\\evil.example', '/'],
  [undefined, '/'],
])('safeRedirect(%s) → %s', (input, expected) => {
  expect(safeRedirect(input)).toBe(expected)
})

test('tokenFromHash 兼容带不带 # 的写法', () => {
  expect(tokenFromHash('#token=abc')).toBe('abc')
  expect(tokenFromHash('token=abc')).toBe('abc')
  expect(tokenFromHash('')).toBeNull()
})

test('unwrap 把网络错误、业务错误、校验错误分别转成对应的 code', async () => {
  await expect(unwrap(Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({
    status: 0,
    code: 'network_error',
  })
  const fail = (status: number, error: unknown) =>
    unwrap(Promise.resolve({ error, response: new Response(null, { status }) }))
  await expect(fail(409, { code: 'email_taken' })).rejects.toMatchObject({ code: 'email_taken' })
  await expect(fail(422, { detail: [] })).rejects.toMatchObject({ code: 'validation_error' })
  await expect(fail(500, 'oops')).rejects.toMatchObject({ code: 'unknown' })
})

test('errorMessage 对未知的错误码给出通用提示', () => {
  const t = i18n.t.bind(i18n)
  expect(errorMessage(t, new ApiError(409, 'email_taken'))).toBe('这个邮箱已经注册过了')
  expect(errorMessage(t, new ApiError(418, 'teapot'))).toBe('出了点问题，请稍后再试')
  expect(errorMessage(t, new Error('boom'))).toBe('出了点问题，请稍后再试')
})
