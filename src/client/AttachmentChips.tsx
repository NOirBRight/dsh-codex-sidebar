/** 批注 chips on the 主会话 composer (ADR 0003). */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarStore } from './controller.ts'

export interface ChipsFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
}

export type ChipsProps = PropsRuntime<'conversation.composer.dock'> & InjectFace<ChipsFace>

export function AttachmentChips({ sessionId, useSidebar }: ChipsProps): ReactNode {
  const attachments = useSidebar((state) => state.bySession[String(sessionId)]?.attachments) ?? []
  if (attachments.length === 0) return null
  return (
    <div className="dcs-chips">
      <span className="dcs-chip">{attachments.length} 批注</span>
      {attachments.map((item) => (
        <span key={item.id} className="dcs-chip">{item.text.slice(0, 24)}</span>
      ))}
    </div>
  )
}
