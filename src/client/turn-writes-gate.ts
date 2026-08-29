/** When the sidebar RPC gate should ship full 本轮变更 payloads. */

export type TurnWritesSnapshot = {
  collapsed: boolean
  active: string | null
  tabs: Array<{ id: string; kind: string | null }>
  attachments?: Array<{ id: string; source?: string }>
}

export type TurnWritesIntent = {
  type: string
  kind?: string
  id?: string
  mark?: string | { source?: string }
}

export function needsTurnWrites(snapshot: TurnWritesSnapshot | undefined, intent?: TurnWritesIntent): boolean {
  if (intent !== undefined && intentEntersReview(intent, snapshot)) return true
  if (snapshot === undefined || snapshot.collapsed) return false
  return snapshot.tabs.find((tab) => tab.id === snapshot.active)?.kind === 'Review'
}

function intentEntersReview(intent: TurnWritesIntent, snapshot: TurnWritesSnapshot | undefined): boolean {
  if (intent.type === 'pick-tool' && intent.kind === 'Review') return true
  if (intent.type.startsWith('review-')) return true
  if (intent.type === 'reveal-mark' && typeof intent.mark === 'object' && intent.mark?.source === 'review') return true
  if (intent.type === 'edit-attachment' && intent.id !== undefined) {
    return snapshot?.attachments?.find((item) => item.id === intent.id)?.source === 'review'
  }
  if (intent.type === 'select-tab' && snapshot !== undefined) {
    return snapshot.tabs.find((tab) => tab.id === intent.id)?.kind === 'Review'
  }
  return false
}
