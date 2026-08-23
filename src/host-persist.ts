/** Persist one SidebarSession JSON blob per 主会话 id. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PersistPort, SidebarSnapshot } from './session.ts'

const LEGACY_ROOT = join(homedir(), '.dsh-codex-sidebar', 'sessions')
export const PERSIST_DEBOUNCE_MS = 500

export type FilePersist = PersistPort & { flush(): Promise<void> }

export function sidebarPersistRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'codex-sidebar', 'sessions')
}

export function createFilePersist(root?: string, legacyRootOverride?: string): FilePersist {
  const targetRoot = root ?? sidebarPersistRoot()
  const legacyRoot = legacyRootOverride ?? (root === undefined && targetRoot !== LEGACY_ROOT ? LEGACY_ROOT : undefined)
  mkdirSync(targetRoot, { recursive: true })
  const latest = new Map<string, SidebarSnapshot>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let chain = Promise.resolve()

  const flushOne = async (sessionId: string): Promise<void> => {
    const snapshot = latest.get(sessionId)
    if (snapshot === undefined) return
    latest.delete(sessionId)
    await mkdir(targetRoot, { recursive: true })
    await writeSnapshotAsync(targetRoot, sessionId, snapshot)
  }

  const flush = async (): Promise<void> => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    const ids = [...new Set([...latest.keys()])]
    chain = chain.then(async () => {
      for (const id of ids) await flushOne(id)
    }, async () => {
      for (const id of ids) await flushOne(id)
    })
    await chain
    if (latest.size > 0) await flush()
  }

  return {
    load(sessionId) {
      const pending = latest.get(sessionId)
      if (pending !== undefined) return pending
      const current = readSnapshot(targetRoot, sessionId)
      if (current !== undefined) return current
      if (legacyRoot === undefined) return undefined
      const legacy = readSnapshot(legacyRoot, sessionId)
      if (legacy === undefined) return undefined
      writeSnapshot(targetRoot, sessionId, legacy)
      return legacy
    },
    save(sessionId, snapshot) {
      latest.set(sessionId, snapshot)
      const prev = timers.get(sessionId)
      if (prev !== undefined) clearTimeout(prev)
      timers.set(sessionId, setTimeout(() => {
        timers.delete(sessionId)
        chain = chain.then(() => flushOne(sessionId), () => flushOne(sessionId))
      }, PERSIST_DEBOUNCE_MS))
      timers.get(sessionId)?.unref?.()
    },
    flush,
  }
}

function writeSnapshot(root: string, sessionId: string, snapshot: SidebarSnapshot): void {
  const file = sessionFile(sessionId)
  const target = join(root, file)
  const temp = join(root, '.' + file + '.' + process.pid + '.tmp')
  writeFileSync(temp, JSON.stringify(snapshot))
  renameSync(temp, target)
}

async function writeSnapshotAsync(root: string, sessionId: string, snapshot: SidebarSnapshot): Promise<void> {
  const file = sessionFile(sessionId)
  const target = join(root, file)
  const temp = join(root, '.' + file + '.' + process.pid + '.' + Date.now() + '.tmp')
  await writeFile(temp, JSON.stringify(snapshot))
  await rename(temp, target)
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
