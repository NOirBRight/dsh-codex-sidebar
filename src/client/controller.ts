/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
} from '../contract.ts'
import { formatDelivery, formatSend } from '../send-text.ts'
import { logEventsFromSession, turnWritesFromSession } from '../turn-writes.ts'
import type { Effect, Intent, SidebarSnapshot } from '../session.ts'
import type { LogEvent, RosterEntry } from '../side-chat.ts'

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

  async refresh(sessionId: string): Promise<SidebarSnapshot | undefined> {
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    if (!result.ok) return undefined
    const snapshot = (result.value as { snapshot: SidebarSnapshot }).snapshot
    this.#put(snapshot)
    this.#syncLayout(snapshot)
    this.#wrapPrompt(sessionId)
    return snapshot
  }

  async dispatch(sessionId: string, intent: Intent, applyEffects = true): Promise<SidebarSnapshot | undefined> {
    const gate = this.#gate(sessionId)
    if (gate === undefined) return undefined
    const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent })
    if (!result.ok) return undefined
    const reply = result.value as { snapshot: SidebarSnapshot; effects: Effect[] }
    this.#put(reply.snapshot)
    this.#syncLayout(reply.snapshot)
    if (applyEffects) await this.#applyEffects(sessionId, reply.effects)
    this.#wrapPrompt(sessionId)
    return reply.snapshot
  }

  installPathTakeover(): void {
    const workspaces = this.#ctx.workspaces
    const original = workspaces.openPath.bind(workspaces)
    workspaces.openPath = async (path: string): Promise<void> => {
      const sessionId = this.#ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        await original(path)
        return
      }
      if (/^https?:\/\//i.test(path)) {
        await this.dispatch(String(sessionId), { type: 'open-url', url: path })
        return
      }
      const cwd = this.#ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd ?? ''
      await this.dispatch(String(sessionId), { type: 'open-path', path: relativize(path, cwd) })
    }
  }

  #gate(sessionId: string): {
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
    const logs = logsFromList(this.#ctx, list.ids as string[])
    const turnWrites = turnWritesFromSession(binding?.session.getSnapshot())
    return { sessionId, cwd: summary?.cwd ?? '', busy, turnWrites, roster, logs }
  }

  #put(snapshot: SidebarSnapshot): void {
    this.#store = {
      bySession: { ...this.#store.bySession, [snapshot.sessionId]: snapshot },
    }
    for (const listener of this.#listeners) listener()
  }

  #syncLayout(snapshot: SidebarSnapshot): void {
    if (snapshot.collapsed) this.#layout.closeDetails()
    else this.#layout.openDetails()
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
