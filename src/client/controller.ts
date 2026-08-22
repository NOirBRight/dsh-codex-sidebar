/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SIDEBAR_BROWSER_CAPTURE_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
  isRecord,
} from '../contract.ts'
import { formatDelivery, formatHumanSend } from '../send-text.ts'
import { stripAnnotationDraftSentinel } from './annotation-draft.ts'
import { logEventsFromSession, turnWritesFromSession } from '../turn-writes.ts'
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

type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg'; data: string; name?: string }
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
  #wrapped = new Set<string>()
  #effectPrompt = new Set<string>()
  #turnWritesCache = new Map<string, { source: unknown; turnWrites: ReturnType<typeof turnWritesFromSession> }>()
  #ctx: ClientContext
  #rpc: ConnectionHandle['rpc']
  #layout: ILayout
  #chain = new Map<string, Promise<unknown>>()
  #depth = new Map<string, number>()
  #pathTakeover = false
  #pendingCollapsed = new Map<string, boolean>()
  #refreshEpoch = new Map<string, number>()

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
          this.#put(snapshot)
          this.#syncLayout(snapshot)
          this.#wrapPrompt(sessionId)
          return snapshot
        } catch {
          // The web host can restart while this mounted client reconnects.
        }
      }
      return undefined
    })
  }

  async dispatch(sessionId: string, intent: Intent, applyEffects = true): Promise<SidebarSnapshot | undefined> {
    const toggle = intent.type === 'toggle-collapsed'
    const work = async (): Promise<SidebarSnapshot | undefined> => {
      const gate = this.#gate(sessionId, !toggle && applyEffects)
      if (gate === undefined) return undefined
      const prepared = await this.#withBrowserEvidence(sessionId, intent, gate)
      if (prepared === undefined) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent: prepared })
      if (!result.ok) return undefined
      const reply = result.value as { snapshot: SidebarSnapshot; effects: Effect[] }
      if (toggle) this.#pendingCollapsed.delete(sessionId)
      this.#put(reply.snapshot)
      this.#syncLayout(reply.snapshot)
      if (applyEffects) {
        try {
          await this.#applyEffects(sessionId, reply.effects)
        } catch (error) {
          const restore = reply.effects.flatMap((effect) => effect.type === 'send' || effect.type === 'queue' ? effect.attachments : [])
          if (restore.length > 0) await this.dispatch(sessionId, { type: 'restore-attachments', attachments: restore }, false)
          throw error
        }
      }
      this.#wrapPrompt(sessionId)
      return reply.snapshot
    }
    if (toggle) return work()
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

  #gate(sessionId: string, includeLogs = false): {
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
    const logs = includeLogs ? logsFromList(this.#ctx, list.ids as string[]) : {}
    const cached = this.#turnWritesCache.get(sessionId)
    const turnWrites = cached?.source === sessionState
      ? cached.turnWrites
      : turnWritesFromSession(sessionState)
    if (sessionState !== cached?.source) this.#turnWritesCache.set(sessionId, { source: sessionState, turnWrites })
    return { sessionId, cwd: summary?.cwd ?? '', busy, turnWrites, roster, logs }
  }

  #put(snapshot: SidebarSnapshot): void {
    const pending = this.#pendingCollapsed.get(snapshot.sessionId)
    const next = pending === undefined ? snapshot : { ...snapshot, collapsed: pending }
    this.#store = {
      bySession: { ...this.#store.bySession, [next.sessionId]: next },
    }
    for (const listener of this.#listeners) listener()
  }

  /**
   * AppFrame columns are pinned by the overlay ColumnPin. Do not closeDetails
   * while the 侧栏 is open — that would collapse the third track.
   */
  readonly hideHostDetails = (): void => {
    this.#applyTrack(true)
  }

  /** Open the AppFrame details track immediately, then persist the expanded flag. */
  reveal(sessionId: string): void {
    const snapshot = this.snap(sessionId)
    if (snapshot?.collapsed === false) {
      this.#applyTrack(false)
      return
    }
    this.#noteCollapsed(sessionId, false)
    this.#applyTrack(false)
    if (snapshot !== undefined) this.#put({ ...snapshot, collapsed: false })
    void this.dispatch(sessionId, { type: 'toggle-collapsed' })
  }

  /** Close the track and optimistically retain the collapsed state locally. */
  hide(sessionId: string): void {
    const snapshot = this.snap(sessionId)
    if (snapshot === undefined || snapshot.collapsed !== false) {
      this.#applyTrack(true)
      return
    }
    this.#noteCollapsed(sessionId, true)
    this.#applyTrack(true)
    this.#put({ ...snapshot, collapsed: true })
    void this.dispatch(sessionId, { type: 'toggle-collapsed' })
  }

  syncTrack(collapsed: boolean | undefined): void {
    this.#applyTrack(collapsed === false ? false : true)
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
      const text = formatHumanSend(effect.text, effect.attachments)
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
  }

  #wrapPrompt(sessionId: string): void {
    if (this.#wrapped.has(sessionId)) return
    const binding = this.#ctx.sessions.binding(sessionId as never)
    if (binding === undefined) return
    const original = binding.session.prompt.bind(binding.session)
    binding.session.prompt = async (content, mode) => {
      if (this.#effectPrompt.has(sessionId)) return original(content, mode)
      const snapshot = this.snap(sessionId)
      if (snapshot === undefined || snapshot.attachments.length === 0) {
        return original(content, mode)
      }
      const parts = content as PromptPart[]
      const text = stripAnnotationDraftSentinel(parts.filter((part): part is Extract<PromptPart, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('\n'))
      const existingImages = parts.filter((part): part is Extract<PromptPart, { type: 'image' }> => part.type === 'image')
      const human = formatHumanSend(text, snapshot.attachments)
      await this.#stageAnnotations(sessionId, snapshot.attachments)
      try {
        const result = await original([{ type: 'text', text: human }, ...existingImages], mode)
        await this.dispatch(sessionId, { type: 'composer-send', text }, false)
        return result
      } catch (error) {
        await this.#unstageAnnotations(sessionId)
        throw error
      }
    }
    this.#wrapped.add(sessionId)
  }
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
