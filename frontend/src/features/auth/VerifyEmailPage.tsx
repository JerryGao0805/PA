import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { meQuery, useVerifyEmail } from './api'
import { tokenFromHash } from './redirect'

export function VerifyEmailPage() {
  const { t } = useTranslation()
  const token = tokenFromHash(useLocation({ select: (l) => l.hash }))
  const verify = useVerifyEmail()
  const { data: me } = useQuery(meQuery)

  // token 只能用一次：React 开发模式下 effect 会执行两次，用 ref 保证只提交一次
  const submitted = useRef(false)
  useEffect(() => {
    if (!token || submitted.current) return
    submitted.current = true
    verify.mutate(token)
  }, [token, verify])

  const state = !token
    ? 'missing'
    : verify.isSuccess
      ? 'success'
      : verify.isError
        ? 'failed'
        : 'pending'

  return (
    <Card>
      <CardHeader className="justify-items-center text-center">
        {state === 'pending' && (
          <LoaderCircle className="mb-2 size-8 animate-spin text-muted-foreground" />
        )}
        {state === 'success' && <CircleCheck className="mb-2 size-8 text-emerald-600" />}
        {(state === 'failed' || state === 'missing') && (
          <CircleX className="mb-2 size-8 text-destructive" />
        )}
        <CardTitle className="text-xl">
          <h1>
            {state === 'pending' && t('auth.verify.verifying')}
            {state === 'success' && t('auth.verify.success')}
            {state === 'failed' && t('auth.verify.failed')}
            {state === 'missing' && t('auth.verify.title')}
          </h1>
        </CardTitle>
        {state === 'failed' && <CardDescription>{t('auth.verify.failedHint')}</CardDescription>}
        {state === 'missing' && <CardDescription>{t('auth.verify.missingToken')}</CardDescription>}
      </CardHeader>
      {state !== 'pending' && (
        <CardContent>
          <Button asChild className="w-full">
            <Link to={me ? '/' : '/login'}>{t('auth.verify.continue')}</Link>
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
