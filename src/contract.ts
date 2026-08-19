/** Host/client RPC contract for one SidebarSession. */

import type { ReviewChange } from './review.ts'
import type { Effect, Intent, SidebarSnapshot } from './session.ts'
import type { LogEvent, RosterEntry } from './side-chat.ts'

export const SIDEBAR_RPC_CHANNEL = '/codex-sidebar'
export const SIDEBAR_SNAPSHOT_ENDPOINT = 'sidebar/snapshot'
export const SIDEBAR_DISPATCH_ENDPOINT = 'sidebar/dispatch'
export const SIDEBAR_TERMINAL_PULL_ENDPOINT = 'sidebar/terminal-pull'
export const SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT = 'sidebar/browser-stream-ticket'
export const SIDEBAR_BROWSER_CAPTURE_ENDPOINT = 'sidebar/browser-capture'
export const SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT = 'sidebar/browser-evidence-commit'
export const SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT = 'sidebar/browser-evidence-read'
export const SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT = 'sidebar/stage-annotations'
export const SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT = 'sidebar/unstage-annotations'

export type SnapshotRequest = {
  sessionId: string
  cwd: string
  busy: boolean
  turnWrites: ReviewChange[]
  roster: RosterEntry[]
  logs: Record<string, LogEvent[]>
}

export type DispatchRequest = SnapshotRequest & {
  intent: Intent
}

export type DispatchReply = {
  snapshot: SidebarSnapshot
  effects: Effect[]
}

export type SnapshotReply = {
  snapshot: SidebarSnapshot
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function decodeSnapshotRequest(payload: unknown): SnapshotRequest | undefined {
  if (!isRecord(payload)) return undefined
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return undefined
  if (typeof payload.cwd !== 'string') return undefined
  if (typeof payload.busy !== 'boolean') return undefined
  return {
    sessionId: payload.sessionId,
    cwd: payload.cwd,
    busy: payload.busy,
    turnWrites: decodeTurnWrites(payload.turnWrites),
    roster: decodeRoster(payload.roster),
    logs: decodeLogs(payload.logs),
  }
}

export function decodeDispatchRequest(payload: unknown): DispatchRequest | undefined {
  const base = decodeSnapshotRequest(payload)
  if (base === undefined || !isRecord(payload) || !isRecord(payload.intent) || typeof payload.intent.type !== 'string') {
    return undefined
  }
  return { ...base, intent: payload.intent as Intent }
}

function decodeTurnWrites(value: unknown): ReviewChange[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return []
  const writes: ReviewChange[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (typeof item.path !== 'string' || typeof item.before !== 'string' || typeof item.after !== 'string') continue
    writes.push({ path: item.path, before: item.before, after: item.after })
  }
  return writes
}

function decodeRoster(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return []
  const roster: RosterEntry[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.cwd !== 'string') continue
    if (item.kind !== 'main' && item.kind !== 'subagent' && item.kind !== 'side-chat') continue
    roster.push({
      id: item.id,
      title: item.title,
      cwd: item.cwd,
      kind: item.kind,
      archived: item.archived === true,
      busy: item.busy === true,
    })
  }
  return roster
}

function decodeLogs(value: unknown): Record<string, LogEvent[]> {
  if (!isRecord(value)) return {}
  const logs: Record<string, LogEvent[]> = {}
  for (const [id, events] of Object.entries(value)) {
    if (!Array.isArray(events)) continue
    logs[id] = events.flatMap((event) => {
      if (!isRecord(event)) return []
      if (typeof event.seq !== 'number' || typeof event.turn !== 'number' || typeof event.role !== 'string') return []
      if (event.role !== 'user' && event.role !== 'assistant' && event.role !== 'tool-call' && event.role !== 'tool-result') {
        return []
      }
      const writes = Array.isArray(event.writes)
        ? event.writes.filter((path): path is string => typeof path === 'string' && path.length > 0)
        : []
      return [{
        seq: event.seq,
        turn: event.turn,
        role: event.role,
        text: typeof event.text === 'string' ? event.text : '',
        ...typeof event.closed === 'boolean' ? { closed: event.closed } : {},
        ...writes.length === 0 ? {} : { writes },
      }]
    })
  }
  return logs
}
