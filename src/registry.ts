/** One SidebarSession per 主会话. */

import { createFsFiles } from './host-files.ts'
import { createSidebarSession } from './session.ts'
import type { FilesPort, PersistPort, SidebarSession } from './session.ts'

export type SessionGate = {
  cwd: string
  busy: boolean
}

export type RegistryOptions = {
  persist: PersistPort
  filesFor?: (sessionId: string, cwdOf: () => string) => FilesPort
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
      })
      live.set(sessionId, created)
      return created
    },
  }
}
