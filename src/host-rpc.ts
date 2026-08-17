/** Decode sidebar RPC and run it against the per-主会话 registry. */

import {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  decodeDispatchRequest,
  decodeSnapshotRequest,
} from './contract.ts'
import type { createRegistry } from './registry.ts'

type Registry = ReturnType<typeof createRegistry>

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

export function handleSidebarRpc(registry: Registry, endpoint: string, payload: unknown): RpcResult<unknown> {
  if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) {
    const request = decodeSnapshotRequest(payload)
    if (request === undefined) return fail('invalid sidebar snapshot request')
    const box = registry.forSession(request.sessionId, request)
    return { ok: true, value: { snapshot: box.snapshot() } }
  }
  if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
    const request = decodeDispatchRequest(payload)
    if (request === undefined) return fail('invalid sidebar dispatch request')
    const box = registry.forSession(request.sessionId, request)
    const effects = box.dispatch(request.intent)
    return { ok: true, value: { snapshot: box.snapshot(), effects } }
  }
  return fail(`unknown sidebar endpoint: ${endpoint}`)
}

function fail(message: string): RpcResult<unknown> {
  return { ok: false, error: { message } }
}
