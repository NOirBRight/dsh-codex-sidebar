/** Persist one SidebarSession JSON blob per 主会话 id. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PersistPort, SidebarSnapshot } from './session.ts'

const LEGACY_ROOT = join(homedir(), '.dsh-codex-sidebar', 'sessions')

export function sidebarPersistRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'codex-sidebar', 'sessions')
}

export function createFilePersist(root?: string, legacyRootOverride?: string): PersistPort {
  const targetRoot = root ?? sidebarPersistRoot()
  const legacyRoot = legacyRootOverride ?? (root === undefined && targetRoot !== LEGACY_ROOT ? LEGACY_ROOT : undefined)
  mkdirSync(targetRoot, { recursive: true })
  return {
    load(sessionId) {
      const current = readSnapshot(targetRoot, sessionId)
      if (current !== undefined) return current
      if (legacyRoot === undefined) return undefined
      const legacy = readSnapshot(legacyRoot, sessionId)
      if (legacy === undefined) return undefined
      // Copy only a session this profile actually requested. Leave the legacy
      // source intact so production/lab migration is reversible.
      writeSnapshot(targetRoot, sessionId, legacy)
      return legacy
    },
    save(sessionId, snapshot) {
      mkdirSync(targetRoot, { recursive: true })
      writeSnapshot(targetRoot, sessionId, snapshot)
    },
  }
}

function writeSnapshot(root: string, sessionId: string, snapshot: SidebarSnapshot): void {
  const file = sessionFile(sessionId)
  const target = join(root, file)
  const temp = join(root, '.' + file + '.' + process.pid + '.tmp')
  writeFileSync(temp, JSON.stringify(snapshot))
  renameSync(temp, target)
}

function readSnapshot(root: string, sessionId: string): SidebarSnapshot | undefined {
  try {
    const raw = readFileSync(join(root, sessionFile(sessionId)), 'utf8')
    return JSON.parse(raw) as SidebarSnapshot
  } catch {
    return undefined
  }
}

function sessionFile(sessionId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error('invalid sidebar session id')
  return sessionId + '.json'
}
