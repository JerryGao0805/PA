import { useEffect, useState } from 'react'

/** value 停止变化 delay 毫秒后才更新的值（例如输入停下来再搜索） */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
