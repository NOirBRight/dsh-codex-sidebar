/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from './shim.js'
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
import { allowTranscriptClick, allowTranscriptTakeover, installTranscriptClickCapture, type TranscriptClickCaptureRoot } from '../transcript-takeover.ts'
import { hunkForOpen, viewForTool } from '../tool-open.ts'
import { hunkForToolRow, type ToolRowHunk } from './tool-stats.ts'
import type { Annotation, BrowserEvidence, Effect, Intent, SidebarSnapshot } from '../session.ts'
import type { BrowserLayout } from '../managed-browser-protocol.ts'
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
  layoutRevision: number
  mediaGeneration: number
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
  #userWatch = new Map<string, { source: unknown; dispose: () => void }>()
  #disposed = false
  #turnWritesCache = new Map<string, { source: unknown; turnWrites: ReturnType<typeof turnWritesFromSession> }>()
  #ctx: ClientContext
  #rpc: ConnectionHandle['rpc']
  #layout: ILayout
  #chain = new Map<string, Promise<unknown>>()
  #depth = new Map<string, number>()
  #pathTakeover = false
  #urlClicks = false
  #layoutReveal: ILayout | undefined
  #revealing = false
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

  /** Release session event subscriptions owned by this controller. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const watches = [...this.#userWatch.values()]
    this.#userWatch.clear()
    for (const watch of watches) watch.dispose()
    this.#listeners.clear()
  }

  snap(sessionId: string): SidebarSnapshot | undefined {
    return this.#store.bySession[sessionId]
  }

  async browserCapture(sessionId: string, tabId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserCaptureReply | undefined> {
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_CAPTURE_ENDPOINT, {
      ...gate, tabId, expectedRevision: expected.revision, expectedMediaGeneration: expected.mediaGeneration,
    })
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
      if (this.snap(sessionId) === undefined && !aborted(signal)) {
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
              await this.#syncStaged(snapshot)
              this.#hostCollapsed.set(sessionId, snapshot.collapsed)
              const applied = this.#put(snapshot)
              this.#syncLayout(applied)
              this.#watchUserTurns(sessionId)
            }
          } catch {
            // Paint chrome from the full snapshot if the light request fails.
          }
        }
      }
      for (const delay of REFRESH_RETRY_MS) {
        if (aborted(signal)) return undefined
        if (delay > 0) {
          await new Promise<void>((resolve) => { setTimeout(resolve, delay) })
          if (aborted(signal)) return undefined
        }
        const gate = this.#gate(sessionId)
        if (gate === undefined) return undefined
        try {
          const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, { ...gate, logs: {} })
          if (!result.ok || !isRecord(result.value) || !isRecord(result.value.snapshot)) continue
          if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return undefined
          const snapshot = result.value.snapshot as unknown as SidebarSnapshot
          await this.#syncStaged(snapshot)
          this.#hostCollapsed.set(sessionId, snapshot.collapsed)
          const applied = this.#put(snapshot)
          this.#syncLayout(applied)
          this.#watchUserTurns(sessionId)
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
    if (intentRevealsSidebar(intent)) this.#revealLocal(sessionId)
    const epoch = this.#refreshEpoch.get(sessionId) ?? 0
    const work = async (): Promise<SidebarSnapshot | undefined> => {
      const gate = this.#gate(sessionId, {
        includeLogs: applyEffects && intent.type === 'side-inspect',
        includeRoster: applyEffects && intentNeedsRoster(intent),
        intent,
      })
      if (gate === undefined) return undefined
      const prepared = await this.#withBrowserEvidence(sessionId, intent, gate)
      if (prepared === undefined) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent: prepared })
      if (!result.ok) return undefined
      const reply = result.value as { snapshot: SidebarSnapshot; effects: Effect[] }
      if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return undefined
      const sending = applyEffects && reply.effects.some((effect) => effect.type === 'send' || effect.type === 'queue')
      if (!sending) await this.#syncStaged(reply.snapshot)
      if (toggle) this.#pendingCollapsed.delete(sessionId)
      else if (intentRevealsSidebar(intent)) this.#writeChrome(sessionId, false)
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
    const candidateTabId = intent.tabId ?? snapshot?.active
    if (typeof candidateTabId !== 'string') return undefined
    const tabId = candidateTabId
    const browser = snapshot?.browsers[tabId]
    if (browser === undefined) return undefined
    let evidence = browser.pendingEvidence
    if (evidence === null) {
      if (browser.pendingCaptureId === null || browser.pendingLayoutRevision === null || browser.pendingMediaGeneration === null) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT, {
        ...gate,
        captureId: browser.pendingCaptureId,
        expectedRevision: browser.pendingLayoutRevision,
        expectedMediaGeneration: browser.pendingMediaGeneration,
      })
      if (!result.ok || !browserEvidence(result.value)) return undefined
      evidence = result.value
    }
    if (browser.pendingDocumentId !== null && evidence.documentId !== browser.pendingDocumentId) return undefined
    if (browser.pendingLayoutRevision !== null && evidence.layoutRevision !== browser.pendingLayoutRevision) return undefined
    if (browser.pendingMediaGeneration !== null && evidence.mediaGeneration !== browser.pendingMediaGeneration) return undefined
    return { ...intent, tabId, evidence }
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
    this.#installUrlClicks()
    this.#installLayoutReveal()
    if (this.#pathTakeover) return
    const workspaces = this.#ctx.workspaces as ClientContext['workspaces'] & {
      openPath?: (path: string) => void | Promise<void>
    }
    this.#pathTakeover = true
    const original = typeof workspaces.openPath === 'function' ? workspaces.openPath.bind(workspaces) : undefined
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
    const patched = async (path: string): Promise<void> => {
      const sessionId = this.#ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        if (original === undefined) throw new Error('no active Session for sidebar path takeover')
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
    if (original !== undefined) {
      try {
        workspaces.openPath = patched
      } catch {
        try {
          Object.defineProperty(workspaces, 'openPath', { value: patched, writable: true, configurable: true })
        } catch {
          // Fall through to Remote session.openWorkspacePath patch below.
        }
      }
    }
    this.#patchRemoteOpenPath(patched)
  }

  #patchRemoteOpenPath(openInSidebar: (path: string) => Promise<void>): void {
    const remote: ClientRemote['session'] | undefined = (this.#ctx as ClientContext & { remote?: ClientRemote }).remote?.session
    if (remote === undefined || typeof remote.openWorkspacePath !== 'function') return
    const original = remote.openWorkspacePath.bind(remote)
    const wrapped: typeof remote.openWorkspacePath = async (req, signal) => {
      const path = req.path
      if (typeof path !== 'string' || path.length === 0) return original(req, signal)
      try {
        await openInSidebar(path)
        return { ok: true, value: { opened: true } }
      } catch {
        return original(req, signal)
      }
    }
    try {
      remote.openWorkspacePath = wrapped
    } catch {
      try {
        Object.defineProperty(remote, 'openWorkspacePath', { value: wrapped, writable: true, configurable: true })
      } catch { /* official OS opener remains */ }
    }
  }

  #installLayoutReveal(): void {
    const layout = this.#layoutFace() as ILayout & { openDetails?: () => void }
    if (this.#layoutReveal === layout || typeof layout.openDetails !== 'function') return
    const original = layout.openDetails.bind(layout)
    const wrapped = (): void => {
      original()
      if (this.#revealing) return
      const current = this.#ctx.sessions.list.getSnapshot().current
      if (current !== undefined) this.#revealLocal(String(current))
    }
    try {
      layout.openDetails = wrapped
      this.#layoutReveal = layout
    } catch {
      try {
        Object.defineProperty(layout, 'openDetails', { value: wrapped, writable: true, configurable: true })
        this.#layoutReveal = layout
      } catch {
        // A replacement layout may appear later; the next reveal retries.
      }
    }
  }

  #installUrlClicks(): void {
    if (this.#urlClicks || typeof document === 'undefined') return
    this.#urlClicks = true
    const onClick = (event: MouseEvent): void => {
      const raw = event.target
      const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null
      if (!(node instanceof Element)) return
      const anchor = node.closest('a')
      if (anchor === null) return
      if (!allowTranscriptClick(event, anchor.hasAttribute('data-dcs-url'))) return
      if (!allowTranscriptTakeover((selector) => anchor.closest(selector))) return
      const href = (anchor.getAttribute('data-dcs-url') ?? anchor.getAttribute('href') ?? '').trim()
      if (!isTakeoverUrl(href)) return
      event.preventDefault()
      event.stopPropagation()
      const sessionId = this.#ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) return
      void this.dispatch(String(sessionId), { type: 'open-url', url: normalizeUrl(href) })
    }
    const roots: TranscriptClickCaptureRoot[] = [document as unknown as TranscriptClickCaptureRoot]
    if (typeof window !== 'undefined') roots.unshift(window as unknown as TranscriptClickCaptureRoot)
    installTranscriptClickCapture(roots, onClick as (event: unknown) => void)
  }

  #gate(sessionId: string, opts: { includeLogs?: boolean; includeRoster?: boolean; intent?: Intent } = {}): {
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
    const roster = opts.includeRoster === true ? rosterFromList(list, archivedIds(this.#ctx)) : []
    const logs = opts.includeLogs === true ? logsFromList(this.#ctx, list.ids as string[]) : {}
    const snapshot = this.snap(sessionId)
    const turnWrites = needsTurnWrites(snapshot, opts.intent)
      ? this.#turnWritesFor(sessionId, sessionState)
      : []
    return { sessionId, cwd: summary?.cwd ?? '', busy, turnWrites, roster, logs }
  }

  #turnWritesFor(sessionId: string, sessionState: unknown): ReturnType<typeof turnWritesFromSession> {
    const cached = this.#turnWritesCache.get(sessionId)
    const turnWrites = cached !== undefined && cached.source === sessionState
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
    this.#revealLocal(sessionId)
    if (this.#hostCollapsed.get(sessionId) !== false) {
      void this.dispatch(sessionId, { type: 'toggle-collapsed' })
    }
  }

  #revealLocal(sessionId: string): void {
    if (this.#revealing) {
      this.#applyTrack(false)
      return
    }
    this.#revealing = true
    try {
      const snapshot = this.snap(sessionId)
      if (snapshot?.collapsed === false) {
        this.#applyTrack(false)
        return
      }
      this.#writeChrome(sessionId, false)
      this.#noteCollapsed(sessionId, false)
      this.#applyTrack(false)
      if (snapshot !== undefined) this.#put({ ...snapshot, collapsed: false })
    } finally {
      this.#revealing = false
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
    try {
      const current = this.#ctx.get('layout') as unknown
      if (isLayoutFace(current)) return current
    } catch {
      // Fall through to the injected property and the boot-time face.
    }
    try {
      if (isLayoutFace(this.#ctx.layout)) return this.#ctx.layout
    } catch {
      // The injected provider can be between Cordis lifecycles on Mobile reconnect.
    }
    return this.#layout
  }

  #applyTrack(collapsed: boolean | undefined): void {
    try {
      if (this.#layoutReveal !== undefined) this.#installLayoutReveal()
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
    const key = stagedAttachmentsKey(snapshot.attachments)
    if (this.#stagedKey.get(snapshot.sessionId) === key) return
    this.#stagedKey.set(snapshot.sessionId, key)
    try {
      if (snapshot.attachments.length === 0) {
        await this.#unstageAnnotations(snapshot.sessionId)
        return
      }
      await this.#stageAnnotations(snapshot.sessionId, snapshot.attachments)
    } catch (error) {
      this.#stagedKey.delete(snapshot.sessionId)
      if (snapshot.attachments.length > 0) throw error
    }
  }

  #watchUserTurns(sessionId: string): void {
    const binding = this.#ctx.sessions.binding(sessionId as never)
    const eventSource = (binding as { eventSource?: unknown } | undefined)?.eventSource
    if (isEventSource(eventSource)) {
      let revision = eventSource.getSnapshot().revision
      this.#replaceUserWatch(sessionId, eventSource, (notify) => eventSource.subscribe(notify), () => {
        const window = eventSource.getSnapshot()
        if (window.revision === revision) return
        revision = window.revision
        if (!changeAddsDirectUserMessage(window.change)) return
        if ((this.snap(sessionId)?.attachments.length ?? 0) > 0) {
          void this.dispatch(sessionId, { type: 'composer-send', text: '' }, false)
        }
      })
      return
    }
    const session = binding?.session as { getSnapshot?: () => unknown; subscribe?: (listener: () => void) => () => void } | undefined
    if (session === undefined || typeof session.subscribe !== 'function' || typeof session.getSnapshot !== 'function') {
      this.#clearUserWatch(sessionId)
      return
    }
    const getSnapshot = session.getSnapshot.bind(session)
    let last = userTurnCount(getSnapshot())
    this.#replaceUserWatch(sessionId, session, (notify) => session.subscribe!(notify), () => {
      if (this.#effectPrompt.has(sessionId)) {
        last = userTurnCount(getSnapshot())
        return
      }
      const next = userTurnCount(getSnapshot())
      if (next > last && (this.snap(sessionId)?.attachments.length ?? 0) > 0) {
        void this.dispatch(sessionId, { type: 'composer-send', text: '' }, false)
      }
      last = next
    })
  }

  #replaceUserWatch(
    sessionId: string,
    source: unknown,
    subscribe: (listener: () => void) => () => void,
    listener: () => void,
  ): void {
    const previous = this.#userWatch.get(sessionId)
    if (previous?.source === source) return
    this.#clearUserWatch(sessionId)
    if (this.#disposed) return
    const watch = { source, dispose: () => {} }
    this.#userWatch.set(sessionId, watch)
    try {
      const dispose = subscribe(() => {
        if (this.#userWatch.get(sessionId) === watch) listener()
      })
      watch.dispose = dispose
      if (this.#userWatch.get(sessionId) !== watch) dispose()
    } catch (error) {
      if (this.#userWatch.get(sessionId) === watch) this.#userWatch.delete(sessionId)
      throw error
    }
  }

  #clearUserWatch(sessionId: string): void {
    const watch = this.#userWatch.get(sessionId)
    if (watch === undefined) return
    this.#userWatch.delete(sessionId)
    watch.dispose()
  }
}

type SessionEventWindowLike = {
  revision: number
  change: unknown
}

function isEventSource(value: unknown): value is {
  getSnapshot: () => SessionEventWindowLike
  subscribe: (listener: () => void) => () => void
} {
  return isRecord(value)
    && typeof value.getSnapshot === 'function'
    && typeof value.subscribe === 'function'
    && isRecord(value.getSnapshot())
    && typeof value.getSnapshot().revision === 'number'
}

function changeAddsDirectUserMessage(change: unknown): boolean {
  if (!isRecord(change) || change.kind !== 'append' || !Array.isArray(change.entries)) return false
  return change.entries.some((entry) => {
    if (!isRecord(entry) || entry.type !== 'event' || !isRecord(entry.event)) return false
    const event = entry.event
    return event.type === 'user/message'
      && isRecord(event.data)
      && isRecord(event.data.source)
      && event.data.source.kind === 'user'
  })
}

function intentNeedsRoster(intent: Intent): boolean {
  return intent.type === 'side-list' || intent.type === 'side-inspect' || intent.type === 'side-deliver'
}

function stagedAttachmentsKey(attachments: readonly Annotation[]): string {
  return stableJson(attachments)
}

function stableJson(value: unknown): string {
  return JSON.stringify(orderJsonProperties(value)) ?? ''
}

function orderJsonProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderJsonProperties)
  if (!isRecord(value)) return value
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) ordered[key] = orderJsonProperties(value[key])
  return ordered
}

function intentRevealsSidebar(intent: Intent): boolean {
  if (intent.type === 'open-url') return intent.reveal !== false
  return intent.type === 'pick-tool'
    || intent.type === 'open-empty-tab'
    || intent.type === 'open-terminal'
    || intent.type === 'open-path'
    || intent.type === 'reveal-mark'
    || intent.type === 'edit-attachment'
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
    && positiveSafeInteger(value.layoutRevision)
    && positiveSafeInteger(value.mediaGeneration)
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
    && positiveSafeInteger(value.layoutRevision)
    && positiveSafeInteger(value.mediaGeneration)
    && typeof value.ref === 'string'
    && value.mediaType === 'image/jpeg'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}


function isLayoutFace(value: unknown): value is ILayout {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { openDetails?: unknown }).openDetails === 'function'
    && typeof (value as { closeDetails?: unknown }).closeDetails === 'function'
}

function relativize(path: string, cwd: string): string {
  if (cwd.length === 0) return path
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (path.startsWith(prefix)) return path.slice(prefix.length)
  if (path === cwd) return ''
  return path
}

function archivedIds(ctx: ClientContext): ReadonlySet<string> {
  const snap = ctx.workspaces.list.getSnapshot() as { archivedSessionIds?: readonly string[] }
  return new Set(snap.archivedSessionIds ?? [])
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
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
