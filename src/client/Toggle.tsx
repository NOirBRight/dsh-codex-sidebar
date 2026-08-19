/** 侧栏开关 button. The overlay host keeps it mounted so a collapse/expand swap cannot hide it. */

import type { ReactElement } from 'react'
import { Ico } from './icons.tsx'
import type { SidebarKey } from './locales.ts'

export function SidebarToggleButton({
  collapsed,
  t,
  onClick,
}: {
  collapsed: boolean
  t: (key: Extract<SidebarKey, 'toggleShow' | 'toggleHide'>) => string
  onClick: () => void
}): ReactElement {
  const label = collapsed ? t('toggleShow') : t('toggleHide')
  return (
    <button
      type="button"
      className="dcs-toggle"
      data-on={!collapsed || undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Ico name="panel" size={16} />
    </button>
  )
}
