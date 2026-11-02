import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ColorPicker } from '@/components/color-picker'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api-error'
import { COLORS } from '@/lib/colors'
import { fieldA11y } from '@/lib/field-a11y'

import { LABEL_NAME_MAX, useCreateLabel, useUpdateLabel, type Label } from './api'

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .max(LABEL_NAME_MAX, { error: 'labels.form.nameMax' })
    .regex(/^\S+$/, { error: 'labels.form.noSpaces' }),
  color: z.enum(COLORS),
})
type Values = z.infer<typeof schema>

interface LabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入时为编辑，否则为新建 */
  label?: Label
  onCreated?: (label: Label) => void
}

export function LabelDialog({ open, onOpenChange, label, onCreated }: LabelDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{label ? t('labels.edit') : t('labels.new')}</DialogTitle>
        </DialogHeader>
        {/* 每次打开都重新挂载表单，回到初始值 */}
        {open && (
          <LabelForm label={label} onDone={() => onOpenChange(false)} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LabelForm({
  label,
  onDone,
  onCreated,
}: {
  label?: Label
  onDone: () => void
  onCreated?: (label: Label) => void
}) {
  const { t } = useTranslation()
  const create = useCreateLabel()
  const update = useUpdateLabel()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: label?.name ?? '', color: label?.color ?? 'gray' },
  })
  const nameError = form.formState.errors.name?.message
  const nameErrorText = nameError ? t(nameError as 'validation.required') : undefined
  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit((values) => {
    // 名字可能和已有标签重复（409），所以等请求成功再关闭对话框
    const onError = (err: unknown) => toast.error(errorMessage(t, err))
    if (label) {
      update.mutate({ id: label.id, patch: values }, { onSuccess: onDone, onError })
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          onDone()
          onCreated?.(created)
        },
        onError,
      })
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormField id="label-name" label={t('labels.form.name')} error={nameErrorText}>
        <Input
          {...fieldA11y('label-name', nameErrorText)}
          autoComplete="off"
          autoFocus
          {...form.register('name')}
        />
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('labels.form.color')}</legend>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />}
        />
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('labels.form.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {label ? t('labels.form.save') : t('labels.form.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
