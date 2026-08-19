/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_TERMINAL_PULL_ENDPOINT,
} from '../contract.ts'
import { formatDelivery, formatSend } from '../send-text.ts'
import { logEventsFromSession, turnWritesFromSession } from '../turn-writes.ts'
import { isTakeoverUrl, normalizeUrl } from '../browser.ts'
import { allowTranscriptTakeover } from '../transcript-takeover.ts'
import { hunkForOpen, viewForTool } from '../tool-open.ts'
import type { Effect, Intent, SidebarSnapshot } from '../session.ts'
import type { LogEvent, RosterEntry } from '../side-chat.ts'
import { applyDetailsTrack } from '../details-occupancy.ts'

export type SidebarStore = {
  bySession: Record<string, SidebarSnapshot>
}

type PromptPart = { type: string; text?: string }

export class SidebarController {
  #store: SidebarStore = { bySession: {} }
  #listeners = new Set<() => void>()
  #wrapped = new Set<string>()
  #ctx: ClientContext
  #rpc: ConnectionHandle['rpc']
  #layout: ILayout
  #chain = new Map<string, Promise<unknown>>()
  #depth = new Map<string, number>()

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

  async refresh(sessionId: string): Promise<SidebarSnapshot | undefined> {
    return this.#enqueue(sessionId, async () => {
      const gate = this.#gate(sessionId)
      if (gate === undefined) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, { ...gate, logs: {} })
      if (!result.ok) return undefined
      const snapshot = (result.value as { snapshot: SidebarSnapshot }).snapshot
      this.#put(snapshot)
      this.#syncLayout(snapshot)
      this.#wrapPrompt(sessionId)
      return snapshot
    })
  }

  async dispatch(sessionId: string, intent: Intent, applyEffects = true): Promise<SidebarSnapshot | undefined> {
    return this.#enqueue(sessionId, async () => {
      const gate = this.#gate(sessionId, true)
      if (gate === undefined) return undefined
      const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent })
      if (!result.ok) return undefined
      const reply = result.value as { snapshot: SidebarSnapshot; effects: Effect[] }
      this.#put(reply.snapshot)
      this.#syncLayout(reply.snapshot)
      if (applyEffects) await this.#applyEffects(sessionId, reply.effects)
      this.#wrapPrompt(sessionId)
      return reply.snapshot
    })
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
    const workspaces = this.#ctx.workspaces
    if (workspaces === undefined || typeof workspaces.openPath !== 'function') return
    const original = workspaces.openPath.bind(workspaces)
    let lastTool: string | undefined
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', (event) => {
        const raw = event.target
        const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null
        const host = node instanceof Element ? node.closest('[data-tool]') : null
        lastTool = host instanceof Element ? host.getAttribute('data-tool') ?? undefined : undefined
      }, true)
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
      const hunk = binding === undefined ? undefined : hunkForOpen(binding.session.getSnapshot(), path, lastTool)
      lastTool = undefined
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
    const busy = binding?.session.getSnapshot().running === true
    const archived = archivedIds(this.#ctx)
    const roster = rosterFromList(list, archived)
    const logs = includeLogs ? logsFromList(this.#ctx, list.ids as string[]) : {}
    const turnWrites = turnWritesFromSession(binding?.session.getSnapshot())
    return { sessionId, cwd: summary?.cwd ?? '', busy, turnWrites, roster, logs }
  }

  #put(snapshot: SidebarSnapshot): void {
    this.#store = {
      bySession: { ...this.#store.bySession, [snapshot.sessionId]: snapshot },
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
    this.#applyTrack(false)
    if (this.snap(sessionId)?.collapsed === false) return
    void this.dispatch(sessionId, { type: 'toggle-collapsed' })
  }

  syncTrack(collapsed: boolean): void {
    this.#applyTrack(collapsed)
  }

  #layoutFace(): ILayout {
    return this.#ctx.layout ?? this.#layout
  }

  #applyTrack(collapsed: boolean): void {
    try {
      applyDetailsTrack(this.#layoutFace(), collapsed)
    } catch {
      // layout face is missing until AppFrame mounts
    }
  }

  #syncLayout(snapshot: { collapsed: boolean }): void {
    this.#applyTrack(snapshot.collapsed)
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
      const text = formatSend(effect.text, effect.attachments)
      if (text.length === 0) continue
      await binding.session.prompt([{ type: 'text', text }], 'queue')
    }
  }

  #wrapPrompt(sessionId: string): void {
    if (this.#wrapped.has(sessionId)) return
    const binding = this.#ctx.sessions.binding(sessionId as never)
    if (binding === undefined) return
    const original = binding.session.prompt.bind(binding.session)
    binding.session.prompt = async (content, mode) => {
      const snapshot = this.snap(sessionId)
      if (snapshot === undefined || snapshot.attachments.length === 0) {
        return original(content, mode)
      }
      const text = content.filter((part: PromptPart) => part.type === 'text').map((part: PromptPart) => part.text ?? '').join('\n')
      const merged = [{ type: 'text' as const, text: formatSend(text, snapshot.attachments) }]
      const result = await original(merged, mode)
      await this.dispatch(sessionId, { type: 'composer-send', text }, false)
      return result
    }
    this.#wrapped.add(sessionId)
  }
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
