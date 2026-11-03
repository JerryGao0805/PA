import type { TFunction } from 'i18next'

/** 前端统一的接口错误：status 为 0 表示网络错误（请求没有到达服务器） */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

function errorCode(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code
  }
  // FastAPI 的请求体校验错误（422）没有 code 字段
  if (status === 422) return 'validation_error'
  return 'unknown'
}

/** 把 openapi-fetch 的结果转成「成功返回 data，失败抛 ApiError」 */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await request
  } catch {
    throw new ApiError(0, 'network_error')
  }
  const { data, error, response } = result
  if (!response.ok) {
    throw new ApiError(response.status, errorCode(response.status, error))
  }
  return data as T
}

const KNOWN_CODES = new Set([
  'invalid_credentials',
  'email_taken',
  'rate_limited',
  'invalid_token',
  'invalid_current_password',
  'not_authenticated',
  'csrf_origin_mismatch',
  'project_not_found',
  'task_not_found',
  'inbox_immutable',
  'invalid_parent',
  'invalid_move',
  'label_not_found',
  'label_name_taken',
  'validation_error',
  'network_error',
])

/** 把任意错误转成给用户看的本地化文案 */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiError && KNOWN_CODES.has(err.code)) {
    return t(`errors.${err.code as 'unknown'}`)
  }
  return t('errors.unknown')
}
