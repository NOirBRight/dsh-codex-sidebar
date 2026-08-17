/** Host/client RPC contract for one SidebarSession. */

import type { Effect, Intent, SidebarSnapshot } from './session.ts'

export const SIDEBAR_RPC_CHANNEL = '/codex-sidebar'
export const SIDEBAR_SNAPSHOT_ENDPOINT = 'sidebar/snapshot'
export const SIDEBAR_DISPATCH_ENDPOINT = 'sidebar/dispatch'

export type SnapshotRequest = {
  sessionId: string
  cwd: string
  busy: boolean
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
  return { sessionId: payload.sessionId, cwd: payload.cwd, busy: payload.busy }
}

export function decodeDispatchRequest(payload: unknown): DispatchRequest | undefined {
  const base = decodeSnapshotRequest(payload)
  if (base === undefined || !isRecord(payload) || !isRecord(payload.intent) || typeof payload.intent.type !== 'string') {
    return undefined
  }
  return { ...base, intent: payload.intent as Intent }
}
