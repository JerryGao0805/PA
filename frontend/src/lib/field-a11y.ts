/** 传给输入框的无障碍属性，配合 FormField 使用 */
export function fieldA11y(id: string, error?: string) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  } as const
}
