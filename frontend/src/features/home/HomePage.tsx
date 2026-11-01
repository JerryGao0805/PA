import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { meQuery } from '@/features/auth/api'

/** 首页占位：M2 会替换成「今天」视图 */
export function HomePage() {
  const { t } = useTranslation()
  const { data: user } = useSuspenseQuery(meQuery)
  const name = user?.display_name || user?.email.split('@')[0] || ''

  return (
    <div className="grid gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t('home.greeting', { name })}</h1>
      <p className="text-muted-foreground">{t('home.placeholder')}</p>
    </div>
  )
}
