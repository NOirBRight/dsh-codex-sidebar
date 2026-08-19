/** Decode sidebar RPC and run it against the per-主会话 registry. */

import {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
  decodeDispatchRequest,
  decodeSnapshotRequest,
  isRecord,
} from './contract.ts'
import type { createRegistry } from './registry.ts'

type Registry = ReturnType<typeof createRegistry>

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

const SNAP_TTL_MS = 200
const snapCache = new Map<string, { at: number; snapshot: unknown }>()

export function handleSidebarRpc(registry: Registry, endpoint: string, payload: unknown): RpcResult<unknown> {
  if (endpoint === SIDEBAR_TERMINAL_PULL_ENDPOINT) {
    if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.tabId !== 'string') {
      return fail('invalid sidebar terminal-pull request')
    }
    const since = typeof payload.since === 'number' ? payload.since : 0
    const box = registry.forSession(payload.sessionId, {
      cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
      busy: payload.busy === true,
    })
    return { ok: true, value: box.pullTerminal(payload.tabId, since) }
  }
  if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) {
    const request = decodeSnapshotRequest(payload)
    if (request === undefined) return fail('invalid sidebar snapshot request')
    const box = registry.forSession(request.sessionId, request)
    return { ok: true, value: { snapshot: snapshotCached(request.sessionId, () => box.snapshot()) } }
  }
  if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
    const request = decodeDispatchRequest(payload)
    if (request === undefined) return fail('invalid sidebar dispatch request')
    const box = registry.forSession(request.sessionId, request)
    const effects = box.dispatch(request.intent)
    snapCache.delete(request.sessionId)
    return { ok: true, value: { snapshot: box.snapshot(), effects } }
  }
  return fail(`unknown sidebar endpoint: ${endpoint}`)
}

function snapshotCached(sessionId: string, compute: () => unknown): unknown {
  const hit = snapCache.get(sessionId)
  const now = Date.now()
  if (hit !== undefined && now - hit.at < SNAP_TTL_MS) return hit.snapshot
  const snapshot = compute()
  snapCache.set(sessionId, { at: now, snapshot })
  return snapshot
}

function fail(message: string): RpcResult<unknown> {
  return { ok: false, error: { message } }
}
