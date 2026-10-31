import { useQuery } from '@tanstack/react-query'

import { healthQuery } from '@/lib/health'

export function HomePage() {
  const health = useQuery(healthQuery)

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">个人助手</h1>
      <p className="text-neutral-500">脚手架已就绪，接下来实现账户系统与任务管理。</p>
      <div className="flex items-center gap-2 text-sm" role="status">
        <span
          className={`size-2 rounded-full ${
            health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-neutral-300'
          }`}
        />
        {health.isPending && '正在连接 API…'}
        {health.isSuccess && 'API 与数据库连接正常'}
        {health.isError && 'API 连接失败'}
      </div>
    </main>
  )
}
