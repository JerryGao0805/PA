import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { unwrap } from '@/lib/api-error'
import type { components } from '@/lib/api-schema'

export type Label = components['schemas']['LabelOut']
type LabelCreate = components['schemas']['LabelCreate']
type LabelUpdate = components['schemas']['LabelUpdate']

export const LABELS_KEY = ['labels'] as const
const TASKS_KEY = ['tasks'] as const

/** 全部标签，按名字排序 */
export const labelsQuery = queryOptions({
  queryKey: LABELS_KEY,
  queryFn: () => unwrap(api.GET('/api/v1/labels')),
})

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name)

/** 标签名的规则和后端一致：去掉首尾空白后 1–50 个字符，中间不能有空白 */
export const LABEL_NAME_MAX = 50
export const hasWhitespace = (name: string) => /\s/.test(name.trim())

export function useCreateLabel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: LabelCreate) => unwrap(api.POST('/api/v1/labels', { body })),
    onSuccess: (label) => {
      queryClient.setQueryData<Label[]>(LABELS_KEY, (labels) =>
        labels ? [...labels, label].sort(byName) : labels,
      )
    },
  })
}

export function useUpdateLabel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LabelUpdate }) =>
      unwrap(
        api.PATCH('/api/v1/labels/{label_id}', {
          params: { path: { label_id: id } },
          body: patch,
        }),
      ),
    onSuccess: (label) => {
      queryClient.setQueryData<Label[]>(LABELS_KEY, (labels) =>
        labels?.map((l) => (l.id === label.id ? label : l)).sort(byName),
      )
    },
  })
}

export function useDeleteLabel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE('/api/v1/labels/{label_id}', { params: { path: { label_id: id } } })),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Label[]>(LABELS_KEY, (labels) => labels?.filter((l) => l.id !== id))
      // 任务上的 label_ids 变了
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}
