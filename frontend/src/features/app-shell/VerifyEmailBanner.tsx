import { MailWarning } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useResendVerification } from '@/features/auth/api'
import { errorMessage } from '@/lib/api-error'

export function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useTranslation()
  const resend = useResendVerification()

  return (
    <div className="border-b bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <MailWarning className="size-4 shrink-0" />
        <span className="flex-1">{t('auth.banner.unverified', { email })}</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-amber-900"
          disabled={resend.isPending || resend.isSuccess}
          onClick={() =>
            resend.mutate(undefined, {
              onSuccess: () => toast.success(t('auth.banner.resent')),
              onError: (err) => toast.error(errorMessage(t, err)),
            })
          }
        >
          {t('auth.banner.resend')}
        </Button>
      </div>
    </div>
  )
}
