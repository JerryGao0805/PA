import type { UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

/** 数据还没到时显示的文字：加载中，或者加载失败（可以重试）。外层的样式由调用方决定 */
export function LoadState({
  query,
}: {
  query: Pick<UseQueryResult, 'isError' | 'isFetching' | 'refetch'>
}) {
  const { t } = useTranslation()
  if (!query.isError || query.isFetching) return t('common.loading')
  return (
    <span role="alert">
      {t('common.loadFailed')}
      <Button
        variant="link"
        size="xs"
        className="h-auto px-1 text-inherit underline"
        onClick={() => void query.refetch()}
      >
        {t('common.retry')}
      </Button>
    </span>
  )
}
