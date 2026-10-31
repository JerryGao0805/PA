/** 只允许站内相对路径，防止 ?redirect=https://evil.example 这类开放重定向 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

/** 从 URL 片段（#token=xxx）里取 token。片段不会发给服务器，不会出现在访问日志里 */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return params.get('token')
}
