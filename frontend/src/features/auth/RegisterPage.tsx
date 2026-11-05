import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FormField } from '@/components/form-field'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api-error'
import { fieldA11y } from '@/lib/field-a11y'
import { browserTimezone } from '@/lib/timezone'

import { useRegister } from './api'
import { registerSchema, type RegisterValues } from './schemas'

export function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const registerUser = useRegister()
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', display_name: '' },
  })
  const { errors } = form.formState
  const fieldError = (key: keyof RegisterValues) =>
    errors[key]?.message ? t(errors[key].message as 'validation.required') : undefined

  const onSubmit = form.handleSubmit((values) =>
    registerUser.mutate(
      { ...values, timezone: browserTimezone() },
      { onSuccess: () => void navigate({ to: '/', replace: true }) },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('auth.register.title')}</h1>
        </CardTitle>
        <CardDescription>{t('auth.register.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {registerUser.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(t, registerUser.error)}</AlertDescription>
            </Alert>
          )}
          <FormField id="email" label={t('common.email')} error={fieldError('email')}>
            <Input
              {...fieldA11y('email', fieldError('email'))}
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register('email')}
            />
          </FormField>
          <FormField
            id="password"
            label={t('common.password')}
            hint={t('auth.register.passwordHint')}
            error={fieldError('password')}
          >
            <PasswordInput
              {...fieldA11y('password', fieldError('password'))}
              autoComplete="new-password"
              {...form.register('password')}
            />
          </FormField>
          <FormField
            id="display_name"
            label={t('auth.register.displayName')}
            hint={t('auth.register.displayNameHint')}
            error={fieldError('display_name')}
          >
            <Input
              {...fieldA11y('display_name', fieldError('display_name'))}
              autoComplete="nickname"
              {...form.register('display_name')}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={registerUser.isPending}>
            {t('auth.register.submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.register.hasAccount')}{' '}
            <Link to="/login" className="font-medium text-foreground hover:underline">
              {t('auth.register.toLogin')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
