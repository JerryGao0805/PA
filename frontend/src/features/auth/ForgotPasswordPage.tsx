import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FormField } from '@/components/form-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api-error'
import { fieldA11y } from '@/lib/field-a11y'

import { useForgotPassword } from './api'
import { forgotSchema, type ForgotValues } from './schemas'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const forgot = useForgotPassword()
  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  })
  const emailError = form.formState.errors.email?.message
  const fieldError = emailError ? t(emailError as 'validation.emailInvalid') : undefined
  const onSubmit = form.handleSubmit(({ email }) => forgot.mutate(email))

  if (forgot.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <MailCheck className="mb-2 size-8 text-muted-foreground" />
          <CardTitle className="text-xl">
            <h1>{t('auth.forgot.sentTitle')}</h1>
          </CardTitle>
          <CardDescription>
            {t('auth.forgot.sent', { email: form.getValues('email') })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">{t('auth.forgot.backToLogin')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('auth.forgot.title')}</h1>
        </CardTitle>
        <CardDescription>{t('auth.forgot.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {forgot.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(t, forgot.error)}</AlertDescription>
            </Alert>
          )}
          <FormField id="email" label={t('common.email')} error={fieldError}>
            <Input
              {...fieldA11y('email', fieldError)}
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register('email')}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={forgot.isPending}>
            {t('auth.forgot.submit')}
          </Button>
          <Link to="/login" className="text-center text-sm text-muted-foreground hover:underline">
            {t('auth.forgot.backToLogin')}
          </Link>
        </form>
      </CardContent>
    </Card>
  )
}
