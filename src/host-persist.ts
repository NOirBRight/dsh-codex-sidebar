/** Persist one SidebarSession JSON blob per 主会话 id. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PersistPort, SidebarSnapshot } from './session.ts'

export function createFilePersist(root = join(homedir(), '.dsh-codex-sidebar', 'sessions')): PersistPort {
  mkdirSync(root, { recursive: true })
  return {
    load(sessionId) {
      try {
        const raw = readFileSync(join(root, `${sessionId}.json`), 'utf8')
        return JSON.parse(raw) as SidebarSnapshot
      } catch {
        return undefined
      }
    },
    save(sessionId, snapshot) {
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, `${sessionId}.json`), JSON.stringify(snapshot))
    },
  }
}
