/** One SidebarSession per 主会话. */

import type { BrowserPort } from './browser.ts'
import { createFsFiles } from './host-files.ts'
import type { ReviewChange, ReviewPort } from './review.ts'
import { createSidebarSession } from './session.ts'
import type { FilesPort, PersistPort, SidebarSession } from './session.ts'
import type { LogEvent, RosterEntry, SideChatPort } from './side-chat.ts'
import type { TerminalPort } from './terminal.ts'

export type SessionGate = {
  cwd: string
  busy: boolean
  turnWrites?: ReviewChange[]
  roster?: RosterEntry[]
  logs?: Record<string, LogEvent[]>
}

export type SessionIo = {
  cwdOf: () => string
  isBusy: () => boolean
  turnWrites: () => ReviewChange[]
  roster: () => RosterEntry[]
  log: (id: string) => LogEvent[]
}

export type RegistryOptions = {
  persist: PersistPort
  filesFor?: (sessionId: string, io: SessionIo) => FilesPort
  reviewFor?: (sessionId: string, io: SessionIo) => ReviewPort
  browserFor?: (sessionId: string, io: SessionIo) => BrowserPort
  terminalFor?: (sessionId: string, io: SessionIo) => TerminalPort
  sideChatFor?: (sessionId: string, io: SessionIo) => SideChatPort
}

export function createRegistry(opts: RegistryOptions): {
  forSession(sessionId: string, gate: SessionGate): SidebarSession
} {
  const live = new Map<string, SidebarSession>()
  const cwd = new Map<string, string>()
  const busy = new Map<string, boolean>()
  const writes = new Map<string, ReviewChange[]>()
  const roster = new Map<string, RosterEntry[]>()
  const logs = new Map<string, Record<string, LogEvent[]>>()
  const filesFor = opts.filesFor ?? ((_id, io) => createFsFiles(io.cwdOf))
  return {
    forSession(sessionId, gate) {
      cwd.set(sessionId, gate.cwd)
      busy.set(sessionId, gate.busy)
      writes.set(sessionId, gate.turnWrites ?? [])
      roster.set(sessionId, gate.roster ?? [])
      logs.set(sessionId, gate.logs ?? {})
      const io: SessionIo = {
        cwdOf: () => cwd.get(sessionId) ?? '',
        isBusy: () => busy.get(sessionId) ?? false,
        turnWrites: () => writes.get(sessionId) ?? [],
        roster: () => roster.get(sessionId) ?? [],
        log: (id) => logs.get(sessionId)?.[id] ?? [],
      }
      const existing = live.get(sessionId)
      if (existing) return existing
      const created = createSidebarSession({
        sessionId,
        files: filesFor(sessionId, io),
        persist: opts.persist,
        isBusy: io.isBusy,
        ...opts.reviewFor === undefined ? {} : { review: opts.reviewFor(sessionId, io) },
        ...opts.browserFor === undefined ? {} : { browser: opts.browserFor(sessionId, io) },
        ...opts.terminalFor === undefined ? {} : { terminal: opts.terminalFor(sessionId, io) },
        ...opts.sideChatFor === undefined ? {} : { sideChat: opts.sideChatFor(sessionId, io) },
      })
      live.set(sessionId, created)
      return created
    },
  }
}
