import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { zhCN } from './locales/zh-CN'

export const defaultNS = 'translation'
export const resources = { 'zh-CN': { translation: zhCN } } as const

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources,
  defaultNS,
  // React 本身会转义，不需要 i18next 再转义一次
  interpolation: { escapeValue: false },
})

export default i18n
