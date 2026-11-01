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

import { useCreateProject, useUpdateProject, type Project } from './api'

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .max(100, { error: 'projects.form.nameMax' }),
  color: z.enum(COLORS),
})
type Values = z.infer<typeof schema>

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入时为编辑，否则为新建 */
  project?: Project
  onCreated?: (project: Project) => void
}

export function ProjectDialog({ open, onOpenChange, project, onCreated }: ProjectDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{project ? t('projects.edit') : t('projects.new')}</DialogTitle>
        </DialogHeader>
        {/* 每次打开都重新挂载表单，回到初始值 */}
        {open && (
          <ProjectForm project={project} onDone={() => onOpenChange(false)} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({
  project,
  onDone,
  onCreated,
}: {
  project?: Project
  onDone: () => void
  onCreated?: (project: Project) => void
}) {
  const { t } = useTranslation()
  const create = useCreateProject()
  const update = useUpdateProject()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: project?.name ?? '', color: project?.color ?? 'gray' },
  })
  const nameError = form.formState.errors.name?.message
  const nameErrorText = nameError ? t(nameError as 'validation.required') : undefined
  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit((values) => {
    const onError = (err: unknown) => toast.error(errorMessage(t, err))
    if (project) {
      // 编辑是乐观更新，先关闭对话框
      update.mutate({ id: project.id, patch: values }, { onError })
      onDone()
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
      <FormField id="project-name" label={t('projects.form.name')} error={nameErrorText}>
        <Input
          {...fieldA11y('project-name', nameErrorText)}
          autoComplete="off"
          autoFocus
          {...form.register('name')}
        />
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('projects.form.color')}</legend>
        <Controller
          control={form.control}
          name="color"
          render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />}
        />
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('projects.form.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {project ? t('projects.form.save') : t('projects.form.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
