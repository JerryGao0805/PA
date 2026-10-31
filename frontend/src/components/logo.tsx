import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Logo() {
  const { t } = useTranslation()
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Check className="size-4" strokeWidth={3} />
      </span>
      {t('app.name')}
    </span>
  )
}
