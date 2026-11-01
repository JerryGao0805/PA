import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { toast } from 'sonner'

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

// Radix 的弹出层、复选框依赖这些浏览器 API，jsdom 没有实现
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
// 路由切换页面时会恢复滚动位置
window.scrollTo = () => {}

afterEach(() => {
  // toast 的状态是全局的，不清掉会带到下一个测试里
  toast.dismiss()
  cleanup()
  vi.unstubAllGlobals()
})
