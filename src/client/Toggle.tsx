/** 侧栏开关: in the header when collapsed; last in the tab bar when open. */

import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Ico } from './icons.tsx'
import { NS, type SidebarKey } from './locales.ts'
import type { SidebarFace } from './Sidebar.tsx'

export type HeaderToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SidebarFace>

export function SidebarToggle({ sessionId, useSidebar, controller, t }: HeaderToggleProps): ReactElement {
  const collapsed = useSidebar((state) => state.bySession[String(sessionId)]?.collapsed) ?? true
  return (
    <SidebarToggleButton
      collapsed={collapsed}
      t={t}
      onClick={() => {
        if (collapsed) controller.reveal(String(sessionId))
        else {
          controller.syncTrack(true)
          void controller.dispatch(String(sessionId), { type: 'toggle-collapsed' })
        }
      }}
    />
  )
}

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
