import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

import '@/i18n'

// jsdom 没有 matchMedia；Sonner（toast）判断系统深浅色时会用到
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
