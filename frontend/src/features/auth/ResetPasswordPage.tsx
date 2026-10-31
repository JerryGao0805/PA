import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/api-error'
import { fieldA11y } from '@/lib/field-a11y'

import { useResetPassword } from './api'
import { tokenFromHash } from './redirect'
import { resetSchema, type ResetValues } from './schemas'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const token = tokenFromHash(useLocation({ select: (l) => l.hash }))
  const reset = useResetPassword()
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '' },
  })
  const pwError = form.formState.errors.password?.message
  const fieldError = pwError ? t(pwError as 'validation.passwordMin') : undefined

  const onSubmit = form.handleSubmit(({ password }) => {
    if (!token) return
    reset.mutate(
      { token, password },
      {
        onSuccess: () => {
          toast.success(t('auth.reset.success'))
          void navigate({ to: '/login', replace: true })
        },
      },
    )
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('auth.reset.title')}</h1>
        </CardTitle>
        <CardDescription>{t('auth.reset.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <div className="grid gap-4">
            <Alert variant="destructive">
              <AlertDescription>{t('auth.reset.missingToken')}</AlertDescription>
            </Alert>
            <Button asChild variant="outline">
              <Link to="/forgot-password">{t('auth.reset.requestAgain')}</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            {reset.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {errorMessage(t, reset.error)}{' '}
                  <Link to="/forgot-password" className="underline">
                    {t('auth.reset.requestAgain')}
                  </Link>
                </AlertDescription>
              </Alert>
            )}
            <FormField id="password" label={t('auth.reset.newPassword')} error={fieldError}>
              <PasswordInput
                {...fieldA11y('password', fieldError)}
                autoComplete="new-password"
                autoFocus
                {...form.register('password')}
              />
            </FormField>
            <Button type="submit" size="lg" disabled={reset.isPending}>
              {t('auth.reset.submit')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
