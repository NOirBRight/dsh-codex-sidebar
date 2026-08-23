/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SIDEBAR_BROWSER_CAPTURE_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_FILE_READ_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
  isRecord,
} from '../contract.ts'
import { formatDelivery } from '../send-text.ts'
import { logEventsFromSession, turnWritesFromSession } from '../turn-writes.ts'
import { needsTurnWrites } from './turn-writes-gate.ts'
import { isTakeoverUrl, normalizeUrl } from '../browser.ts'
import { allowTranscriptTakeover } from '../transcript-takeover.ts'
import { hunkForOpen, viewForTool } from '../tool-open.ts'
import { hunkForToolRow, type ToolRowHunk } from './tool-stats.ts'
import type { Annotation, BrowserEvidence, Effect, Intent, SidebarSnapshot } from '../session.ts'
import type { LogEvent, RosterEntry } from '../side-chat.ts'
import { applyDetailsTrack } from '../details-occupancy.ts'
import { pinHostDetailsTrack } from './host-frame.ts'

export type SidebarStore = {
  bySession: Record<string, SidebarSnapshot>
}

const REFRESH_RETRY_MS = [0, 100, 250, 500, 1_000, 2_000, 3_000, 5_000] as const

export type BrowserCaptureReply = {
  captureId: string
  documentId: string
  url: string
  title: string
  width: number
  height: number
  nodes: Array<{ ref: string; role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }>
}

export class SidebarController {
  #store: SidebarStore = { bySession: {} }
  #listeners = new Set<() => void>()
  #effectPrompt = new Set<string>()
  #stagedKey = new Map<string, string>()
  #userWatch = new Set<string>()
  #turnWritesCache = new Map<string, { source: unknown; turnWrites: ReturnType<typeof turnWritesFromSession> }>()
  #ctx: ClientContext
  #rpc: ConnectionHandle['rpc']
  #layout: ILayout
  #chain = new Map<string, Promise<unknown>>()
  #depth = new Map<string, number>()
  #pathTakeover = false
  #pendingCollapsed = new Map<string, boolean>()
  /** This client's details-track chrome. Host `collapsed` is not applied here. */
  #chromeCollapsed = new Map<string, boolean>()
  #hostCollapsed = new Map<string, boolean>()
  #refreshEpoch = new Map<string, number>()
  #filePreview = new Map<string, string>()

  constructor(ctx: ClientContext) {
    this.#ctx = ctx
    this.#rpc = (ctx.get('connection') as ConnectionHandle).rpc
    this.#layout = ctx.layout
  }

  readonly getSnapshot = (): SidebarStore => this.#store

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  snap(sessionId: string): SidebarSnapshot | undefined {
    return this.#store.bySession[sessionId]
  }

  async browserCapture(sessionId: string, tabId: string): Promise<BrowserCaptureReply | undefined> {
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_CAPTURE_ENDPOINT, { ...gate, tabId })
    if (!result.ok || !captureReply(result.value)) return undefined
    return result.value
  }

  async browserStreamTicket(sessionId: string, tabId: string): Promise<{ path: string; expiresAt: number } | undefined> {
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT, { ...gate, tabId })
    if (!result.ok || result.value === undefined || typeof result.value !== 'object' || result.value === null) return undefined
    const value = result.value as { path?: unknown; expiresAt?: unknown }
    if (typeof value.path !== 'string' || typeof value.expiresAt !== 'number') return undefined
    return { path: value.path, expiresAt: value.expiresAt }
  }

  async pullTerminal(sessionId: string, tabId: string, since: number): Promise<{ seq: number; chunk: string } | undefined> {
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_TERMINAL_PULL_ENDPOINT, {
      sessionId,
      tabId,
      since,
    })
    if (!result.ok || result.value === undefined || typeof result.value !== 'object' || result.value === null) {
      return undefined
    }
    const rec = result.value as { seq?: unknown; chunk?: unknown }
    if (typeof rec.seq !== 'number' || typeof rec.chunk !== 'string') return undefined
    return { seq: rec.seq, chunk: rec.chunk }
  }

  async refresh(sessionId: string, signal?: AbortSignal): Promise<SidebarSnapshot | undefined> {
    return this.#enqueue(sessionId, async () => {
      const epoch = this.#refreshEpoch.get(sessionId) ?? 0
      if (this.snap(sessionId) === undefined && signal?.aborted !== true) {
        const lightGate = this.#gate(sessionId)
        if (lightGate !== undefined) {
          try {
            const light = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, {
              ...lightGate,
              logs: {},
              light: true,
            })
            if (light.ok && isRecord(light.value) && isRecord(light.value.snapshot)) {
              if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return undefined
              const snapshot = light.value.snapshot as unknown as SidebarSnapshot
              this.#hostCollapsed.set(sessionId, snapshot.collapsed)
              const applied = this.#put(snapshot)
              this.#syncLayout(applied)
              this.#watchUserTurns(sessionId)
              void this.#syncStaged(applied)
            }
          } catch {
            // Paint chrome from the full snapshot if the light request fails.
          }
        }
      }
      for (const delay of REFRESH_RETRY_MS) {
        if (signal?.aborted === true) return undefined
        if (delay > 0) {
          await new Promise<void>((resolve) => { setTimeout(resolve, delay) })
          if (signal?.aborted === true) return undefined
        }
        const gate = this.#gate(sessionId)
        if (gate === undefined) return undefined
        try {
          const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, { ...gate, logs: {} })
          if (!result.ok || !isRecord(result.value) || !isRecord(result.value.snapshot)) continue
          if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return undefined
          const snapshot = result.value.snapshot as unknown as SidebarSnapshot
          this.#hostCollapsed.set(sessionId, snapshot.collapsed)
          const applied = this.#put(snapshot)
          this.#syncLayout(applied)
          this.#watchUserTurns(sessionId)
          void this.#syncStaged(applied)
          return applied
        } catch {
          // The web host can restart while this mounted client reconnects.
        }
      }
      return this.snap(sessionId)
    })
  }

  async readFilePreview(sessionId: string, path: string): Promise<string | undefined> {
    const key = sessionId + '\0' + path
    const hit = this.#filePreview.get(key)
    if (hit !== undefined) return hit
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_FILE_READ_ENDPOINT, {
      sessionId,
      cwd: gate.cwd,
      path,
    })
    if (!result.ok || !isRecord(result.value) || typeof result.value.preview !== 'string') return undefined
    if (this.#filePreview.size >= 4) {
      const first = this.#filePreview.keys().next().value
      if (first !== undefined) this.#filePreview.delete(first)
    }
    this.#filePreview.set(key, result.value.preview)
    return result.value.preview
  }

  async dispatch(sessionId: string, intent: Intent, applyEffects = true): Promise<SidebarSnapshot | undefined> {
    const toggle = intent.type === 'toggle-collapsed'
    const epoch = this.#refreshEpoch.get(sessionId) ?? 0
    const work = async (): Promise<SidebarSnapshot | undefined> => {
      const gate = this.#gate(sessionId, { includeLogs: !toggle && applyEffects, intent })
      if (gate === undefined) return undefined
      const prepared = await this.#withBrowserEvidence(sessionId, intent, gate)
      if (prepared === undefined) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent: prepared })
      if (!result.ok) return undefined
      const reply = result.value as { snapshot: SidebarSnapshot; effects: Effect[] }
      if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return undefined
      if (toggle) this.#pendingCollapsed.delete(sessionId)
      else this.#writeChrome(sessionId, reply.snapshot.collapsed)
      this.#hostCollapsed.set(sessionId, reply.snapshot.collapsed)
      const applied = this.#put(reply.snapshot)
      this.#syncLayout(applied)
      this.#watchUserTurns(sessionId)
      if (applyEffects) {
        try {
          await this.#applyEffects(sessionId, reply.effects)
        } catch (error) {
          const restore = reply.effects.flatMap((effect) => effect.type === 'send' || effect.type === 'queue' ? effect.attachments : [])
          if (restore.length > 0) await this.dispatch(sessionId, { type: 'restore-attachments', attachments: restore }, false)
          throw error
        }
      }
      const sending = applyEffects && reply.effects.some((effect) => effect.type === 'send' || effect.type === 'queue')
      if (!sending) void this.#syncStaged(applied)
      return applied
    }
    return this.#enqueue(sessionId, work)
  }


  async #withBrowserEvidence(
    sessionId: string,
    intent: Intent,
    gate: {
      sessionId: string
      cwd: string
      busy: boolean
      turnWrites: ReturnType<typeof turnWritesFromSession>
      roster: RosterEntry[]
      logs: Record<string, LogEvent[]>
    },
  ): Promise<Intent | undefined> {
    if (intent.type !== 'browser-note-add' && intent.type !== 'browser-note-send') return intent
    const snapshot = this.snap(sessionId)
    const tabId = snapshot?.active
    const browser = tabId === null || tabId === undefined ? undefined : snapshot?.browsers[tabId]
    if (browser === undefined) return undefined
    let evidence = browser.pendingEvidence
    if (evidence === null) {
      if (browser.pendingCaptureId === null) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT, {
        ...gate,
        captureId: browser.pendingCaptureId,
      })
      if (!result.ok || !browserEvidence(result.value)) return undefined
      evidence = result.value
    }
    if (browser.pendingDocumentId !== null && evidence.documentId !== browser.pendingDocumentId) return undefined
    return { ...intent, evidence }
  }

  #enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    if ((this.#depth.get(sessionId) ?? 0) > 0) return work()
    const prev = this.#chain.get(sessionId) ?? Promise.resolve()
    const run = async (): Promise<T> => {
      this.#depth.set(sessionId, 1)
      try {
        return await work()
      } finally {
        this.#depth.set(sessionId, 0)
      }
    }
    const next = prev.then(run, run)
    this.#chain.set(sessionId, next.then(() => undefined, () => undefined))
    return next
  }

  installPathTakeover(): void {
    if (this.#pathTakeover) return
    const workspaces = this.#ctx.workspaces
    if (workspaces === undefined || typeof workspaces.openPath !== 'function') return
    this.#pathTakeover = true
    const original = workspaces.openPath.bind(workspaces)
    let lastTool: string | undefined
    let lastHunkId: string | undefined
    let lastRowHunk: ToolRowHunk | undefined
    if (typeof document !== 'undefined') {
      const captureToolContext = (target: EventTarget | null): void => {
        const raw = target
        const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null
        const host = node instanceof Element ? node.closest('[data-tool]') : null
        lastTool = host instanceof Element ? host.getAttribute('data-tool') ?? undefined : undefined
        lastHunkId = host instanceof HTMLElement ? host.dataset.dcsHunkId : undefined
        lastRowHunk = host instanceof HTMLElement ? hunkForToolRow(host) : undefined
      }
      document.addEventListener('pointerdown', (event) => { captureToolContext(event.target) }, true)
      // Keyboard activation has no pointerdown; capture the row before the host click handler runs.
      document.addEventListener('click', (event) => { captureToolContext(event.target) }, true)
    }
    workspaces.openPath = async (path: string): Promise<void> => {
      const sessionId = this.#ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        await original(path)
        return
      }
      if (isTakeoverUrl(path)) {
        await this.dispatch(String(sessionId), { type: 'open-url', url: normalizeUrl(path) })
        return
      }
      const cwd = this.#ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd ?? ''
      const view = viewForTool(lastTool)
      const binding = this.#ctx.sessions.binding(sessionId as never)
      const hunk = lastRowHunk
        ?? (binding === undefined ? undefined : hunkForOpen(binding.session.getSnapshot(), path, lastTool, lastHunkId))
      lastTool = undefined
      lastHunkId = undefined
      lastRowHunk = undefined
      await this.dispatch(String(sessionId), {
        type: 'open-path',
        path: relativize(path, cwd),
        view,
        ...(hunk === undefined ? {} : { before: hunk.before, after: hunk.after }),
      })
    }
    this.#installUrlClicks()
  }

  #installUrlClicks(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const raw = event.target
      const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null
      if (!(node instanceof Element)) return
      const anchor = node.closest('a')
      if (anchor === null) return
      if (!allowTranscriptTakeover((selector) => anchor.closest(selector))) return
      const href = (anchor.getAttribute('href') ?? '').trim()
      if (!isTakeoverUrl(href)) return
      event.preventDefault()
      event.stopPropagation()
      const sessionId = this.#ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) return
      void this.dispatch(String(sessionId), { type: 'open-url', url: normalizeUrl(href) })
    }, true)
  }

  #gate(sessionId: string, opts: { includeLogs?: boolean; intent?: Intent } = {}): {
    sessionId: string
    cwd: string
    busy: boolean
    turnWrites: ReturnType<typeof turnWritesFromSession>
    roster: RosterEntry[]
    logs: Record<string, LogEvent[]>
  } | undefined {
    const list = this.#ctx.sessions.list.getSnapshot()
    const summary = list.byId[sessionId as keyof typeof list.byId]
    const binding = this.#ctx.sessions.binding(sessionId as never)
    const sessionState = binding?.session.getSnapshot()
    const busy = sessionState?.running === true
    const archived = archivedIds(this.#ctx)
    const roster = rosterFromList(list, archived)
    const logs = opts.includeLogs === true ? logsFromList(this.#ctx, list.ids as string[]) : {}
    const snapshot = this.snap(sessionId)
    const turnWrites = needsTurnWrites(snapshot, opts.intent)
      ? this.#turnWritesFor(sessionId, sessionState)
      : []
    return { sessionId, cwd: summary?.cwd ?? '', busy, turnWrites, roster, logs }
  }

  #turnWritesFor(sessionId: string, sessionState: unknown): ReturnType<typeof turnWritesFromSession> {
    const cached = this.#turnWritesCache.get(sessionId)
    const turnWrites = cached?.source === sessionState
      ? cached.turnWrites
      : turnWritesFromSession(sessionState)
    if (sessionState !== cached?.source) this.#turnWritesCache.set(sessionId, { source: sessionState, turnWrites })
    return turnWrites
  }

  #put(snapshot: SidebarSnapshot): SidebarSnapshot {
    const pending = this.#pendingCollapsed.get(snapshot.sessionId)
    const chrome = this.#chromeCollapsed.get(snapshot.sessionId)
    const next = { ...snapshot, collapsed: pending ?? chrome ?? true }
    this.#store = {
      bySession: { ...this.#store.bySession, [next.sessionId]: next },
    }
    for (const listener of this.#listeners) listener()
    return next
  }

  /**
   * AppFrame columns are pinned by the overlay ColumnPin. Do not closeDetails
   * while the 侧栏 is open — that would collapse the third track.
   */
  readonly hideHostDetails = (): void => {
    this.#applyTrack(true)
  }

  /** Open this client's details track. Other surfaces keep their own chrome. */
  reveal(sessionId: string): void {
    const snapshot = this.snap(sessionId)
    if (snapshot?.collapsed === false) {
      this.#applyTrack(false)
      return
    }
    this.#writeChrome(sessionId, false)
    this.#noteCollapsed(sessionId, false)
    this.#applyTrack(false)
    if (snapshot !== undefined) this.#put({ ...snapshot, collapsed: false })
    if (this.#hostCollapsed.get(sessionId) !== false) {
      void this.dispatch(sessionId, { type: 'toggle-collapsed' })
    }
  }

  /** Close this client's details track without collapsing other surfaces. */
  hide(sessionId: string): void {
    const snapshot = this.snap(sessionId)
    if (snapshot === undefined || snapshot.collapsed !== false) {
      this.#applyTrack(true)
      return
    }
    this.#writeChrome(sessionId, true)
    this.#noteCollapsed(sessionId, true)
    this.#applyTrack(true)
    this.#put({ ...snapshot, collapsed: true })
  }

  syncTrack(collapsed: boolean | undefined): void {
    this.#applyTrack(collapsed === false ? false : true)
  }

  #writeChrome(sessionId: string, collapsed: boolean): void {
    this.#chromeCollapsed.set(sessionId, collapsed)
  }

  #noteCollapsed(sessionId: string, collapsed: boolean): void {
    this.#pendingCollapsed.set(sessionId, collapsed)
    if (this.snap(sessionId) !== undefined) {
      this.#refreshEpoch.set(sessionId, (this.#refreshEpoch.get(sessionId) ?? 0) + 1)
    }
  }

  #layoutFace(): ILayout {
    return this.#ctx.layout ?? this.#layout
  }

  #applyTrack(collapsed: boolean | undefined): void {
    try {
      applyDetailsTrack(this.#layoutFace(), collapsed)
    } catch {
      // layout face is missing until AppFrame mounts
    }
    pinHostDetailsTrack(collapsed)
  }

  #syncLayout(snapshot: { collapsed: boolean }): void {
    this.#applyTrack(snapshot.collapsed)
  }


  async #stageAnnotations(sessionId: string, attachments: readonly Annotation[]): Promise<void> {
    if (attachments.length === 0) return
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT, { sessionId, attachments })
    if (!result.ok) throw new Error((result as { error?: { message?: string } }).error?.message ?? 'Cannot stage 批注')
  }

  async #unstageAnnotations(sessionId: string): Promise<void> {
    try {
      await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT, { sessionId })
    } catch {
      // staging is host-side; a failed unstage leaves a TTL'd sidecar
    }
  }

  async #applyEffects(sessionId: string, effects: Effect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.type === 'deliver') {
        const target = this.#ctx.sessions.binding(effect.to as never)
        if (target === undefined) continue
        const text = formatDelivery(effect.text, effect.sourceTab, effect.sourceSession)
        await target.session.prompt([{ type: 'text', text }], 'queue')
        continue
      }
      if (effect.type === 'side-ask') continue
      const binding = this.#ctx.sessions.binding(sessionId as never)
      if (binding === undefined) continue
      const text = effect.text
      if (text.length === 0) continue
      await this.#stageAnnotations(sessionId, effect.attachments)
      this.#effectPrompt.add(sessionId)
      try {
        await binding.session.prompt([{ type: 'text', text }], 'queue')
      } catch (error) {
        await this.#unstageAnnotations(sessionId)
        throw error
      } finally {
        this.#effectPrompt.delete(sessionId)
      }
    }
    const leftover = this.snap(sessionId)
    if (leftover !== undefined) void this.#syncStaged(leftover)
  }

  async #syncStaged(snapshot: SidebarSnapshot): Promise<void> {
    const key = snapshot.attachments.map((item) => item.id).join(',')
    if (this.#stagedKey.get(snapshot.sessionId) === key) return
    this.#stagedKey.set(snapshot.sessionId, key)
    try {
      if (snapshot.attachments.length === 0) {
        await this.#unstageAnnotations(snapshot.sessionId)
        return
      }
      await this.#stageAnnotations(snapshot.sessionId, snapshot.attachments)
    } catch {
      this.#stagedKey.delete(snapshot.sessionId)
    }
  }

  #watchUserTurns(sessionId: string): void {
    if (this.#userWatch.has(sessionId)) return
    const binding = this.#ctx.sessions.binding(sessionId as never)
    const session = binding?.session as { getSnapshot?: () => unknown; subscribe?: (listener: () => void) => () => void } | undefined
    if (session === undefined || typeof session.subscribe !== 'function' || typeof session.getSnapshot !== 'function') return
    this.#userWatch.add(sessionId)
    let last = userTurnCount(session.getSnapshot())
    session.subscribe(() => {
      if (this.#effectPrompt.has(sessionId)) {
        last = userTurnCount(session.getSnapshot())
        return
      }
      const next = userTurnCount(session.getSnapshot())
      if (next > last && (this.snap(sessionId)?.attachments.length ?? 0) > 0) {
        void this.dispatch(sessionId, { type: 'composer-send', text: '' }, false)
      }
      last = next
    })
  }
}


function userTurnCount(snapshot: unknown): number {
  if (!isRecord(snapshot)) return 0
  if (Array.isArray(snapshot.messages)) {
    return snapshot.messages.filter((item) => isRecord(item) && (item.role === 'user' || item.kind === 'user')).length
  }
  const chat = isRecord(snapshot.chat) ? snapshot.chat : snapshot
  const legacy = isRecord(chat.legacy) ? chat.legacy : chat
  const nodes = isRecord(legacy) ? legacy.nodes : undefined
  if (nodes instanceof Map) {
    let count = 0
    for (const node of nodes.values()) {
      if (isRecord(node) && (node.role === 'user' || node.kind === 'user')) count += 1
    }
    return count
  }
  if (Array.isArray(nodes)) {
    return nodes.filter((item) => isRecord(item) && (item.role === 'user' || item.kind === 'user')).length
  }
  return 0
}

function captureReply(value: unknown): value is BrowserCaptureReply {
  return isRecord(value)
    && typeof value.captureId === 'string'
    && typeof value.documentId === 'string'
    && typeof value.url === 'string'
    && typeof value.title === 'string'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && Array.isArray(value.nodes)
}

function browserEvidence(value: unknown): value is BrowserEvidence {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.captureId === 'string'
    && typeof value.documentId === 'string'
    && typeof value.ref === 'string'
    && value.mediaType === 'image/jpeg'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
}


function relativize(path: string, cwd: string): string {
  if (cwd.length === 0) return path
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (path.startsWith(prefix)) return path.slice(prefix.length)
  if (path === cwd) return ''
  return path
}

function archivedIds(ctx: ClientContext): ReadonlySet<string> {
  const snap = ctx.workspaces.list.getSnapshot() as { archivedSessionIds?: string[] }
  return new Set(snap.archivedSessionIds ?? [])
}

function rosterFromList(list: { ids: string[]; byId: Record<string, {
  id?: string
  displayTitle?: string
  title?: string
  cwd?: string
  origin?: string
  parentId?: string
  running?: boolean
}> }, archived: ReadonlySet<string>): RosterEntry[] {
  return list.ids.map((id) => {
    const row = list.byId[id]
    const origin = row?.origin
    const kind: RosterEntry['kind'] = origin === 'subagent' || row?.parentId !== undefined ? 'subagent' : 'main'
    return {
      id,
      title: row?.displayTitle ?? row?.title ?? id,
      cwd: row?.cwd ?? '',
      kind,
      archived: archived.has(id),
      busy: row?.running === true,
    }
  })
}

function logsFromList(ctx: ClientContext, ids: string[]): Record<string, LogEvent[]> {
  const logs: Record<string, LogEvent[]> = {}
  for (const id of ids) {
    const binding = ctx.sessions.binding(id as never)
    if (binding === undefined) continue
    logs[id] = logEventsFromSession(binding.session.getSnapshot())
  }
  return logs
}
