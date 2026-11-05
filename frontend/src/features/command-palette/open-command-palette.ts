import { createContext, useContext } from 'react'

export const OpenCommandPalette = createContext<() => void>(() => {})

/** 打开搜索面板（侧边栏上的按钮用） */
export const useOpenCommandPalette = () => useContext(OpenCommandPalette)

/**
 * 快捷键用 Mac 上的 Cmd、其他系统的 Ctrl。Mac 不认 Ctrl+K：输入框里它是「删到行尾」。
 * 看 platform 而不是 userAgent：userAgent 可能是伪装的（Playwright 的 Desktop Chrome 设备就是 Windows 的），
 * 键盘却是本机的。每次按键时再判断（测试里可以换掉）
 */
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform)

/** 快捷键里的修饰键：Mac 上是 ⌘，其他系统是 Ctrl */
export const MOD_KEY = isMac() ? '⌘' : 'Ctrl '
