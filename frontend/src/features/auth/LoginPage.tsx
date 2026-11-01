import { zodResolver } from '@hookform/resolvers/zod'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
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

import { useLogin } from './api'
import { safeRedirect } from './redirect'
import { loginSchema, type LoginValues } from './schemas'

const route = getRouteApi('/_auth/login')

export function LoginPage() {
  const { t } = useTranslation()
  const { redirect } = route.useSearch()
  const navigate = useNavigate()
  const login = useLogin()
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors } = form.formState
  const fieldError = (key: keyof LoginValues) =>
    errors[key]?.message ? t(errors[key].message as 'validation.required') : undefined

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => void navigate({ to: safeRedirect(redirect), replace: true }),
    }),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>{t('auth.login.title')}</h1>
        </CardTitle>
        <CardDescription>{t('auth.login.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {login.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(t, login.error)}</AlertDescription>
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
            error={fieldError('password')}
            aside={
              <Link to="/forgot-password" className="text-sm text-muted-foreground hover:underline">
                {t('auth.login.forgot')}
              </Link>
            }
          >
            <PasswordInput
              {...fieldA11y('password', fieldError('password'))}
              autoComplete="current-password"
              {...form.register('password')}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={login.isPending}>
            {t('auth.login.submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.login.noAccount')}{' '}
            <Link to="/register" className="font-medium text-foreground hover:underline">
              {t('auth.login.toRegister')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
