/** Stacked 批注 chips: 主会话 dock and 侧栏 chrome share this strip. */

import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { Annotation } from '../session.ts'
import { SidebarController, type SidebarStore } from './controller.ts'
import { Ico } from './icons.tsx'
import { annotationDraftProjection } from './annotation-draft.ts'

export interface ChipsFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
  controller: SidebarController
}

export type ChipsProps = PropsRuntime<'conversation.input.dock'> & InjectFace<ChipsFace>

export function AttachmentChips({ sessionId, useSidebar, controller, input, inputActions }: ChipsProps): ReactNode {
  const attachments = useSidebar((state) => state.bySession[String(sessionId)]?.attachments) ?? []
  const projectedDraft = annotationDraftProjection(input.draft, attachments.length, input.imageIds.length)

  useEffect(() => {
    if (projectedDraft === input.draft) return
    inputActions.setDraft(projectedDraft)
  }, [input.draft, inputActions, projectedDraft])

  return (
    <AttachmentStrip
      attachments={attachments}
      dock
      onEdit={(id) => { void controller.dispatch(String(sessionId), { type: 'edit-attachment', id }) }}
      onRemove={(id) => { void controller.dispatch(String(sessionId), { type: 'remove-attachment', id }) }}
    />
  )
}

export function AttachmentStrip({
  attachments,
  onRemove,
  onEdit,
  onSend,
  dock,
}: {
  attachments: readonly Annotation[]
  onRemove: (id: string) => void
  onEdit?: (id: string) => void
  onSend?: () => void
  dock?: boolean
}): ReactNode {
  if (attachments.length === 0) return null
  return (
    <div className={dock ? 'dcs-chips dcs-chips-dock' : 'dcs-chips'}>
      <span className="dcs-chip dcs-chip-count">{attachments.length} 批注</span>
      {attachments.map((item, index) => (
        <span key={item.id} className="dcs-chip">
          <button
            type="button"
            className="dcs-chip-open"
            aria-label={`编辑批注 ${index + 1}`}
            onClick={() => { onEdit?.(item.id) }}
          >
            <span className="dcs-chip-n">{index + 1}</span>
            <span className="dcs-chip-from">{item.from}</span>
          </button>
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
      {onSend !== undefined && (
        <button
          type="button"
          className="dcs-chips-send"
          title="发送批注"
          aria-label="发送批注"
          onClick={onSend}
        >
          <Ico name="send" size={13} />
        </button>
      )}
    </div>
  )
}
