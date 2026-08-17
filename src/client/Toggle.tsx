/** 侧栏开关 in the 主会话 header utilities. */

import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { Ico } from './icons.tsx'
import { NS } from './locales.ts'
import type { SidebarStore } from './controller.ts'
import type { SidebarController } from './controller.ts'

export interface ToggleFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
  controller: SidebarController
}

export type ToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<ToggleFace>

export function SidebarToggle({ sessionId, useSidebar, controller, t }: ToggleProps): ReactElement {
  const collapsed = useSidebar((state) => state.bySession[String(sessionId)]?.collapsed) ?? true
  return (
    <button
      type="button"
      className="dcs-toggle"
      data-on={!collapsed || undefined}
      aria-label={collapsed ? t('toggleShow') : t('toggleHide')}
      title={collapsed ? t('toggleShow') : t('toggleHide')}
      onClick={() => { void controller.dispatch(String(sessionId), { type: 'toggle-collapsed' }) }}
    >
      <Ico name="panel" size={16} />
    </button>
  )
}
