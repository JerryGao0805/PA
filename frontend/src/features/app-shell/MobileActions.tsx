import { Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { useOpenCommandPalette } from '@/features/command-palette/open-command-palette'
import { useOpenQuickAdd } from '@/features/quick-add/open-quick-add'

/**
 * 手机上没有键盘快捷键，侧边栏又收在抽屉里：顶栏右边放「搜索」，右下角放「快速添加」（单手够得着）。
 * 按 isMobile 渲染而不是用 CSS 藏起来：桌面上侧边栏里已经有同名的按钮
 */
export function MobileSearchButton() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const openCommandPalette = useOpenCommandPalette()
  if (!isMobile) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      className="ml-auto"
      aria-label={t('command.open')}
      onClick={openCommandPalette}
    >
      <Search />
    </Button>
  )
}

export function MobileQuickAddButton() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const openQuickAdd = useOpenQuickAdd()
  if (!isMobile) return null
  return (
    <Button
      className="fixed right-4 bottom-4 z-40 size-14 rounded-full shadow-lg"
      aria-label={t('quickAdd.open')}
      onClick={openQuickAdd}
    >
      <Plus className="size-6" />
    </Button>
  )
}
