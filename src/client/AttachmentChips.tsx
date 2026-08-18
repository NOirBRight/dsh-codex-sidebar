/** Stacked 批注 chips: 主会话 dock and 侧栏 chrome share this strip. */

import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { Annotation } from '../session.ts'
import { SidebarController, type SidebarStore } from './controller.ts'
import { Ico } from './icons.tsx'

export interface ChipsFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
  controller: SidebarController
}

export type ChipsProps = PropsRuntime<'conversation.input.dock'> & InjectFace<ChipsFace>

export function AttachmentChips({ sessionId, useSidebar, controller }: ChipsProps): ReactNode {
  const attachments = useSidebar((state) => state.bySession[String(sessionId)]?.attachments) ?? []
  return (
    <AttachmentStrip
      attachments={attachments}
      onRemove={(id) => { void controller.dispatch(String(sessionId), { type: 'remove-attachment', id }) }}
    />
  )
}

export function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: readonly Annotation[]
  onRemove: (id: string) => void
}): ReactNode {
  if (attachments.length === 0) return null
  return (
    <div className="dcs-chips">
      <span className="dcs-chip dcs-chip-count">{attachments.length} 批注</span>
      {attachments.map((item, index) => (
        <span key={item.id} className="dcs-chip">
          <span className="dcs-chip-n">{index + 1}</span>
          <span className="dcs-chip-from">{item.from}</span>
          <button
            type="button"
            className="dcs-chip-x"
            aria-label="移除批注"
            onClick={() => { onRemove(item.id) }}
          >
            <Ico name="x" size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
