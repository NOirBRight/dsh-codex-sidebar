/** Decode sidebar RPC and run it against the per-主会话 registry. */

import {
  SIDEBAR_BROWSER_CAPTURE_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT,
  SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
  decodeDispatchRequest,
  decodeSnapshotRequest,
  isRecord,
} from './contract.ts'
import type { createRegistry } from './registry.ts'
import type { ManagedBrowserStream } from './managed-browser-stream.ts'
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts'
import type { ManagedBrowserEvidenceStore } from './managed-browser-evidence.ts'
import { browserDeviceViewport } from './browser.ts'
import type { BrowserEvidence, SidebarSnapshot } from './session.ts'
import type { WorkspaceInspector } from './workspace-inspector.ts'
import {
  AnnotationSendStore,
  buildStagedBatch,
  decodeAnnotationList,
  type AnnotationSendPorts,
} from './host-annotation-send.ts'

type Registry = ReturnType<typeof createRegistry>

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

const SNAP_TTL_MS = 200

export type SidebarRpcServices = {
  browserStream?: ManagedBrowserStream
  managedBrowser?: ManagedBrowserRuntime
  browserEvidence?: ManagedBrowserEvidenceStore
  annotationSend?: AnnotationSendStore
  annotationPortsFor?: (sessionId: string) => AnnotationSendPorts
  workspace?: WorkspaceInspector
}

const snapCache = new Map<string, { at: number; revision: number; gateKey: string; snapshot: unknown }>()
const snapPending = new Map<string, { epoch: number; revision: number; gateKey: string; promise: Promise<unknown> }>()
const snapEpoch = new Map<string, number>()

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
      const snapshot = box.snapshot(false)
      const tab = snapshot.tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
      const url = snapshot.browsers[payload.tabId]?.url || tab?.target
      if (tab === undefined || url === undefined || url.length === 0) return fail('unknown Browser Tab')
      const tabKey = { sessionId: payload.sessionId, tabId: payload.tabId }
      const projection = await services.managedBrowser.ensure(tabKey, url)
      if (projection.status !== 'ready') return fail(projection.error ?? 'Browser page is not ready')
      const viewport = browserDeviceViewport(snapshot.browsers[payload.tabId]?.device ?? 'fit')
      if (viewport !== null) await services.managedBrowser.resize(tabKey, viewport.width, viewport.height)
      return { ok: true, value: services.browserStream.issue(tabKey) }
    }
    if (endpoint === SIDEBAR_BROWSER_CAPTURE_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string' || typeof payload.tabId !== 'string') {
        return fail('invalid sidebar browser-capture request')
      }
      if (services.browserEvidence === undefined) return fail('Browser evidence capture is unavailable')
      const box = registry.forSession(payload.sessionId, { cwd: typeof payload.cwd === 'string' ? payload.cwd : '', busy: payload.busy === true })
      const tab = box.snapshot(false).tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
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
    if (endpoint === SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string') return fail('invalid sidebar stage-annotations request')
      const attachments = decodeAnnotationList(payload.attachments)
      if (attachments === undefined) return fail('invalid 批注 list')
      if (services.annotationSend === undefined) return fail('annotation send is unavailable')
      const ports = services.annotationPortsFor?.(payload.sessionId) ?? {}
      if (attachments.length === 0) {
        services.annotationSend.replacePending(payload.sessionId, null)
        return { ok: true, value: { staged: true } }
      }
      const batch = await buildStagedBatch(payload.sessionId, attachments, ports)
      services.annotationSend.replacePending(payload.sessionId, batch)
      return { ok: true, value: { staged: true } }
    }
    if (endpoint === SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT) {
      if (!isRecord(payload) || typeof payload.sessionId !== 'string') return fail('invalid sidebar unstage-annotations request')
      services.annotationSend?.unstage(payload.sessionId)
      return { ok: true, value: { unstaged: true } }
    }
    synchronizeManagedState(registry, payload, services)
    if (services.workspace !== undefined) {
      const projected = await handleWorkspaceRpc(registry, endpoint, payload, services.workspace)
      if (projected !== undefined) return projected
    }
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
    const tab = box.snapshot(false).tabs.find((item) => item.id === payload.tabId && item.kind === 'Browser')
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
    return { ok: true, value: { snapshot: snapshotCached(request.sessionId, box.revision(), () => box.snapshot()) } }
  }
  if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
    const request = decodeDispatchRequest(payload)
    if (request === undefined) return fail('invalid sidebar dispatch request')
    const box = registry.forSession(request.sessionId, request)
    const effects = box.dispatch(request.intent)
    invalidateSnapshot(request.sessionId)
    return { ok: true, value: { snapshot: box.snapshot(), effects } }
  }
  return fail(`unknown sidebar endpoint: ${endpoint}`)
}

async function handleWorkspaceRpc(
  registry: Registry,
  endpoint: string,
  payload: unknown,
  workspace: WorkspaceInspector,
): Promise<RpcResult<unknown> | undefined> {
  if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) {
    const request = decodeSnapshotRequest(payload)
    if (request === undefined) return fail('invalid sidebar snapshot request')
    const box = registry.forSession(request.sessionId, request)
    const base = box.snapshot(false)
    const revision = box.revision()
    const gateKey = projectionGateKey(request)
    const snapshot = await snapshotCachedAsync(request.sessionId, revision, gateKey, () => projectOrBase(workspace, base, request), () => box.revision())
    return { ok: true, value: { snapshot } }
  }
  if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
    const request = decodeDispatchRequest(payload)
    if (request === undefined) return fail('invalid sidebar dispatch request')
    const box = registry.forSession(request.sessionId, request)
    const effects = box.dispatch(request.intent)
    invalidateSnapshot(request.sessionId)
    if (request.intent.type === 'toggle-collapsed') {
      return { ok: true, value: { snapshot: box.snapshot(), effects } }
    }
    const snapshot = await projectOrBase(workspace, box.snapshot(false), request)
    return { ok: true, value: { snapshot, effects } }
  }
  return undefined
}

async function projectOrBase(workspace: WorkspaceInspector, base: SidebarSnapshot, gate: Parameters<WorkspaceInspector['project']>[1]): Promise<SidebarSnapshot> {
  try {
    return await workspace.project(base, gate)
  } catch {
    return base
  }
}

async function snapshotCachedAsync(sessionId: string, revision: number, gateKey: string, compute: () => Promise<unknown>, currentRevision: () => number): Promise<unknown> {
  const hit = snapCache.get(sessionId)
  if (hit !== undefined && hit.revision === revision && hit.gateKey === gateKey && Date.now() - hit.at < SNAP_TTL_MS) return hit.snapshot
  const epoch = snapEpoch.get(sessionId) ?? 0
  const pending = snapPending.get(sessionId)
  if (pending !== undefined && pending.epoch === epoch && pending.revision === revision && pending.gateKey === gateKey) return pending.promise
  let created!: Promise<unknown>
  created = compute().then((snapshot) => {
    if ((snapEpoch.get(sessionId) ?? 0) === epoch && currentRevision() === revision) {
      snapCache.set(sessionId, { at: Date.now(), revision, gateKey, snapshot })
    }
    return snapshot
  }).finally(() => {
    if (snapPending.get(sessionId)?.promise === created) snapPending.delete(sessionId)
  })
  snapPending.set(sessionId, { epoch, revision, gateKey, promise: created })
  return created
}

function invalidateSnapshot(sessionId: string): void {
  snapEpoch.set(sessionId, (snapEpoch.get(sessionId) ?? 0) + 1)
  snapCache.delete(sessionId)
  snapPending.delete(sessionId)
}

function synchronizeManagedState(registry: Registry, payload: unknown, services: SidebarRpcServices): void {
  if (services.managedBrowser === undefined || !isRecord(payload) || typeof payload.sessionId !== 'string') return
  const box = registry.forSession(payload.sessionId, {
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    busy: payload.busy === true,
  })
  let changed = false
  for (const projection of services.managedBrowser.list()) {
    if (projection.sessionId !== payload.sessionId) continue
    const current = box.snapshot(false).browsers[projection.tabId]
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
    changed = true
  }
  if (changed) invalidateSnapshot(payload.sessionId)
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

function snapshotCached(sessionId: string, revision: number, compute: () => unknown): unknown {
  const hit = snapCache.get(sessionId)
  const now = Date.now()
  if (hit !== undefined && hit.gateKey === '' && hit.revision === revision && now - hit.at < SNAP_TTL_MS) return hit.snapshot
  const snapshot = compute()
  snapCache.set(sessionId, { at: Date.now(), revision, gateKey: '', snapshot })
  return snapshot
}

function projectionGateKey(request: { cwd: string; busy: boolean; turnWrites: Array<{ path: string; before: string; after: string }> }): string {
  let hash = 2166136261
  const add = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  add(request.cwd)
  add(request.busy ? '1' : '0')
  for (const write of request.turnWrites) {
    add(write.path); add(write.before); add(write.after)
  }
  return String(hash >>> 0)
}

function fail(message: string): RpcResult<unknown> {
  return { ok: false, error: { message } }
}
