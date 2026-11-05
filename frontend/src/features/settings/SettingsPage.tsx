import { zodResolver } from '@hookform/resolvers/zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { meQuery, type User } from '@/features/auth/api'
import { PageHeader } from '@/features/tasks/PageHeader'
import { errorMessage } from '@/lib/api-error'
import { fieldA11y } from '@/lib/field-a11y'
import { browserTimezone, timezoneLabel } from '@/lib/timezone'
import { cn } from '@/lib/utils'

import { useChangePassword, useDeleteAccount, useUpdateAccount } from './api'
import {
  changePasswordSchema,
  deleteAccountSchema,
  profileSchema,
  type ChangePasswordValues,
  type DeleteAccountValues,
  type ProfileValues,
} from './schemas'
import { TimezonePicker } from './TimezonePicker'

/** 设置页：个人资料（名字、时区）、修改密码、删除账户 */
export function SettingsPage() {
  const { t } = useTranslation()
  // 路由的 beforeLoad 已确保用户已登录
  const { data: user } = useSuspenseQuery(meQuery)
  if (!user) return null

  return (
    <div className="grid gap-6">
      <PageHeader title={t('settings.title')} />
      <ProfileSection user={user} />
      <PasswordSection user={user} />
      <DeleteAccountSection user={user} />
    </div>
  )
}

function Section({
  id,
  title,
  description,
  danger,
  children,
}: {
  id: string
  title: string
  description?: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <Card
      role="region"
      aria-labelledby={`${id}-title`}
      className={cn(danger && 'ring-destructive/30')}
    >
      <CardHeader>
        <CardTitle>
          <h2 id={`${id}-title`} className={cn('text-base', danger && 'text-destructive')}>
            {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** 翻译表单校验的错误（schema 里写的是 i18n key） */
function useFieldError() {
  const { t } = useTranslation()
  return (message?: string) => (message ? t(message as 'validation.required') : undefined)
}

function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const update = useUpdateAccount()
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: user.display_name, timezone: user.timezone },
  })
  const nameError = fieldError(form.formState.errors.display_name?.message)
  const timezone = useWatch({ control: form.control, name: 'timezone' })
  const detected = browserTimezone()

  const onSubmit = form.handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: (saved) => {
        form.reset({ display_name: saved.display_name, timezone: saved.timezone })
        toast.success(t('settings.profile.saved'))
      },
    }),
  )

  return (
    <Section id="profile" title={t('settings.profile.title')}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {update.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, update.error)}</AlertDescription>
          </Alert>
        )}
        <FormField
          id="profile-email"
          label={t('common.email')}
          hint={
            user.email_verified ? t('settings.profile.verified') : t('settings.profile.unverified')
          }
        >
          <Input id="profile-email" value={user.email} readOnly className="text-muted-foreground" />
        </FormField>
        <FormField id="display-name" label={t('settings.profile.name')} error={nameError}>
          <Input
            {...fieldA11y('display-name', nameError)}
            autoComplete="nickname"
            placeholder={user.email.split('@')[0]}
            {...form.register('display_name')}
          />
        </FormField>
        <FormField id="timezone" label={t('settings.timezone.label')}>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <TimezonePicker id="timezone" value={field.value} onChange={field.onChange} />
            )}
          />
          <p className="text-sm text-muted-foreground">
            {t('settings.timezone.hint')}
            {detected !== timezone && (
              <>
                {' '}
                {t('settings.timezone.detected', { timezone: timezoneLabel(detected) })}{' '}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4"
                  onClick={() => form.setValue('timezone', detected, { shouldDirty: true })}
                >
                  {t('settings.timezone.useDetected')}
                </button>
              </>
            )}
          </p>
        </FormField>
        <div>
          <Button type="submit" disabled={!form.formState.isDirty || update.isPending}>
            {t('settings.profile.save')}
          </Button>
        </div>
      </form>
    </Section>
  )
}

function PasswordSection({ user }: { user: User }) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const change = useChangePassword()
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '' },
  })
  const currentError = fieldError(form.formState.errors.current_password?.message)
  const newError = fieldError(form.formState.errors.new_password?.message)

  const onSubmit = form.handleSubmit((values) =>
    change.mutate(values, {
      onSuccess: () => {
        form.reset()
        toast.success(t('settings.password.changed'))
      },
    }),
  )

  return (
    <Section
      id="password"
      title={t('settings.password.title')}
      description={t('settings.password.description')}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {/* 让密码管理器知道这是哪个账号的密码 */}
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        {change.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, change.error)}</AlertDescription>
          </Alert>
        )}
        <FormField
          id="current-password"
          label={t('settings.password.current')}
          error={currentError}
        >
          <PasswordInput
            {...fieldA11y('current-password', currentError)}
            autoComplete="current-password"
            {...form.register('current_password')}
          />
        </FormField>
        <FormField
          id="new-password"
          label={t('settings.password.new')}
          hint={t('settings.password.newHint')}
          error={newError}
        >
          <PasswordInput
            {...fieldA11y('new-password', newError)}
            autoComplete="new-password"
            {...form.register('new_password')}
          />
        </FormField>
        <div>
          <Button type="submit" disabled={change.isPending}>
            {t('settings.password.submit')}
          </Button>
        </div>
      </form>
    </Section>
  )
}

function DeleteAccountSection({ user }: { user: User }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Section
      id="delete-account"
      title={t('settings.delete.title')}
      description={t('settings.delete.description')}
      danger
    >
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t('settings.delete.open')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        {/* 关上时卸载：下次打开是空的密码框，也不带着上次的错误 */}
        {open && <DeleteAccountDialog user={user} />}
      </AlertDialog>
    </Section>
  )
}

function DeleteAccountDialog({ user }: { user: User }) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const navigate = useNavigate()
  // 提示放在这里而不是 mutate 的 onSuccess 里：跳到登录页时这个对话框已经卸载了，那里的回调不会执行
  const remove = useDeleteAccount(async () => {
    await navigate({ to: '/login', replace: true })
    toast.success(t('settings.delete.deleted'))
  })
  const form = useForm<DeleteAccountValues>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: '' },
  })
  const passwordError = fieldError(form.formState.errors.password?.message)

  const onSubmit = form.handleSubmit(({ password }) => remove.mutate(password))

  return (
    <AlertDialogContent>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.delete.dialogTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('settings.delete.dialogDescription', { email: user.email })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        {remove.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, remove.error)}</AlertDescription>
          </Alert>
        )}
        <FormField id="delete-password" label={t('common.password')} error={passwordError}>
          <PasswordInput
            {...fieldA11y('delete-password', passwordError)}
            autoComplete="current-password"
            autoFocus
            {...form.register('password')}
          />
        </FormField>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">{t('settings.delete.cancel')}</AlertDialogCancel>
          <Button type="submit" variant="destructive" disabled={remove.isPending}>
            {t('settings.delete.confirm')}
          </Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  )
}
