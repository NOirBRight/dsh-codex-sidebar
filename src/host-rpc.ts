/** Decode sidebar RPC and run it against the per-主会话 registry. */

import {
  SIDEBAR_BROWSER_CAPTURE_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT,
  SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
  decodeDispatchRequest,
  decodeSnapshotRequest,
  isRecord,
} from './contract.ts'
import type { createRegistry } from './registry.ts'
import type { ManagedBrowserStream } from './managed-browser-stream.ts'
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts'
import type { ManagedBrowserEvidenceStore } from './managed-browser-evidence.ts'
import type { BrowserEvidence } from './session.ts'

type Registry = ReturnType<typeof createRegistry>

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

const SNAP_TTL_MS = 200

export type SidebarRpcServices = {
  browserStream?: ManagedBrowserStream
  managedBrowser?: ManagedBrowserRuntime
  browserEvidence?: ManagedBrowserEvidenceStore
}

const snapCache = new Map<string, { at: number; snapshot: unknown }>()

export async function handleSidebarRpcAsync(
  registry: Registry,
  endpoint: string,
  payload: unknown,
  services: SidebarRpcServices = {},
): Promise<RpcResult<unknown>> {
  try {
    if (endpoint === SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT && services.managedBrowser !== undefined) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.tabId !== 'string') {
        return fail('invalid sidebar browser-stream-ticket request')
      }
      if (services.browserStream === undefined) return fail('managed browser stream is unavailable')
      const box = registry.forSession(payload.sessionId, { cwd: typeof payload.cwd === 'string' ? payload.cwd : '', busy: payload.busy === true })
      const snapshot = box.snapshot()
      const tab = snapshot.tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
      const url = snapshot.browsers[payload.tabId]?.url || tab?.target
      if (tab === undefined || url === undefined || url.length === 0) return fail('unknown Browser Tab')
      const projection = await services.managedBrowser.ensure({ sessionId: payload.sessionId, tabId: payload.tabId }, url)
      if (projection.status !== 'ready') return fail(projection.error ?? 'Browser page is not ready')
      return { ok: true, value: services.browserStream.issue({ sessionId: payload.sessionId, tabId: payload.tabId }) }
    }
    if (endpoint === SIDEBAR_BROWSER_CAPTURE_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.tabId !== 'string') {
        return fail('invalid sidebar browser-capture request')
      }
      if (services.browserEvidence === undefined) return fail('Browser evidence capture is unavailable')
      const box = registry.forSession(payload.sessionId, { cwd: typeof payload.cwd === 'string' ? payload.cwd : '', busy: payload.busy === true })
      const tab = box.snapshot().tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
      if (tab === undefined) return fail('unknown Browser Tab')
      return { ok: true, value: await services.browserEvidence.capture({ sessionId: payload.sessionId, tabId: payload.tabId }) }
    }
    if (endpoint === SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.captureId !== 'string') {
        return fail('invalid sidebar browser-evidence-commit request')
      }
      if (services.browserEvidence === undefined) return fail('Browser evidence commit is unavailable')
      return { ok: true, value: await services.browserEvidence.commit(payload.sessionId, payload.captureId) }
    }
    if (endpoint === SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string') return fail('invalid sidebar browser-evidence-read request')
      const evidence = decodeEvidence(payload.evidence)
      if (evidence === undefined) return fail('invalid Browser evidence descriptor')
      if (services.browserEvidence === undefined) return fail('Browser evidence read is unavailable')
      return { ok: true, value: await services.browserEvidence.read(payload.sessionId, evidence) }
    }
    synchronizeManagedState(registry, payload, services)
    return handleSidebarRpc(registry, endpoint, payload, services)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export function handleSidebarRpc(
  registry: Registry,
  endpoint: string,
  payload: unknown,
  services: SidebarRpcServices = {},
): RpcResult<unknown> {
  if (endpoint === SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT) {
    if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.tabId !== 'string') {
      return fail('invalid sidebar browser-stream-ticket request')
    }
    if (services.browserStream === undefined) return fail('managed browser stream is unavailable')
    const box = registry.forSession(payload.sessionId, {
      cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
      busy: payload.busy === true,
    })
    const tab = box.snapshot().tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
    if (tab === undefined) return fail('unknown Browser Tab')
    return { ok: true, value: services.browserStream.issue({ sessionId: payload.sessionId, tabId: payload.tabId }) }
  }
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



function synchronizeManagedState(registry: Registry, payload: unknown, services: SidebarRpcServices): void {
  if (services.managedBrowser === undefined || !isRecord(payload) || typeof payload.sessionId !== 'string') return
  const box = registry.forSession(payload.sessionId, {
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    busy: payload.busy === true,
  })
  for (const projection of services.managedBrowser.list()) {
    if (projection.sessionId !== payload.sessionId) continue
    const current = box.snapshot().browsers[projection.tabId]
    if (
      current === undefined
      || (
        current.url === projection.url
        && current.documentId === projection.documentId
        && current.runtimeStatus === projection.status
        && current.runtimeError === (projection.error ?? null)
      )
    ) continue
    box.dispatch({
      type: 'browser-runtime-sync',
      tabId: projection.tabId,
      url: projection.url,
      title: projection.title,
      documentId: projection.documentId,
      status: projection.status,
      ...projection.error === undefined ? {} : { error: projection.error },
    })
  }
}

function decodeEvidence(value: unknown): BrowserEvidence | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.id !== 'string'
    || typeof value.captureId !== 'string'
    || typeof value.documentId !== 'string'
    || typeof value.ref !== 'string'
    || value.mediaType !== 'image/jpeg'
    || typeof value.width !== 'number'
    || typeof value.height !== 'number'
  ) return undefined
  return {
    id: value.id,
    captureId: value.captureId,
    documentId: value.documentId,
    ref: value.ref,
    mediaType: value.mediaType,
    width: value.width,
    height: value.height,
  }
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
