import { queryOptions } from '@tanstack/react-query'

import { api } from './api'

export const healthQuery = queryOptions({
  queryKey: ['health'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/v1/health')
    if (error || !data) throw new Error('API 不可用')
    return data
  },
  retry: false,
})
