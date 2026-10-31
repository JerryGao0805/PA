import createClient from 'openapi-fetch'

import type { paths } from './api-schema'

// 前端和 API 同源部署，直接用当前页面的 origin；Cookie 会随同源请求自动携带。
// fetch 每次调用时再读取全局对象（而不是创建客户端时捕获），方便测试里 mock。
export const api = createClient<paths>({
  baseUrl: globalThis.location.origin,
  fetch: (request) => globalThis.fetch(request),
})
