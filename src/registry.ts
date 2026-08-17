/** One SidebarSession per 主会话. */

import type { BrowserPort } from './browser.ts'
import { createFsFiles } from './host-files.ts'
import type { ReviewPort } from './review.ts'
import { createSidebarSession } from './session.ts'
import type { FilesPort, PersistPort, SidebarSession } from './session.ts'
import type { SideChatPort } from './side-chat.ts'
import type { TerminalPort } from './terminal.ts'

export type SessionGate = {
  cwd: string
  busy: boolean
}

export type RegistryOptions = {
  persist: PersistPort
  filesFor?: (sessionId: string, cwdOf: () => string) => FilesPort
  reviewFor?: (sessionId: string) => ReviewPort
  browserFor?: (sessionId: string) => BrowserPort
  terminalFor?: (sessionId: string) => TerminalPort
  sideChatFor?: (sessionId: string) => SideChatPort
}

export function createRegistry(opts: RegistryOptions): {
  forSession(sessionId: string, gate: SessionGate): SidebarSession
} {
  const live = new Map<string, SidebarSession>()
  const cwd = new Map<string, string>()
  const busy = new Map<string, boolean>()
  const filesFor = opts.filesFor ?? ((_id, cwdOf) => createFsFiles(cwdOf))
  return {
    forSession(sessionId, gate) {
      cwd.set(sessionId, gate.cwd)
      busy.set(sessionId, gate.busy)
      const existing = live.get(sessionId)
      if (existing) return existing
      const created = createSidebarSession({
        sessionId,
        files: filesFor(sessionId, () => cwd.get(sessionId) ?? ''),
        persist: opts.persist,
        isBusy: () => busy.get(sessionId) ?? false,
        ...opts.reviewFor === undefined ? {} : { review: opts.reviewFor(sessionId) },
        ...opts.browserFor === undefined ? {} : { browser: opts.browserFor(sessionId) },
        ...opts.terminalFor === undefined ? {} : { terminal: opts.terminalFor(sessionId) },
        ...opts.sideChatFor === undefined ? {} : { sideChat: opts.sideChatFor(sessionId) },
      })
      live.set(sessionId, created)
      return created
    },
  }
}
