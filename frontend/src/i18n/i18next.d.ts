import 'i18next'

import type { defaultNS, resources } from './index'

// 让 t('...') 的 key 有类型检查和自动补全
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
    resources: (typeof resources)['zh-CN']
  }
}
