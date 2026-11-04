import { createContext, useContext } from 'react'

export const OpenQuickAdd = createContext<() => void>(() => {})

/** 打开快速添加（侧边栏上的按钮用） */
export const useOpenQuickAdd = () => useContext(OpenQuickAdd)
