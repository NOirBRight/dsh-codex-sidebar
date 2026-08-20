/** Read-only workspace FilesPort backed by the 主会话 cwd. */

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { defaultGitExec, gitRepo } from './git-status.ts'
import type { FilesPort } from './session.ts'
import { collectTree } from './workspace-tree.ts'

export function createFsFiles(cwdOf: () => string): FilesPort {
  return {
    read(path) {
      const cwd = cwdOf()
      const full = isAbsolute(path) ? path : cwd.length === 0 ? undefined : join(cwd, path)
      if (full === undefined) return undefined
      try {
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
          const buf = readFileSync(full)
          return 'data:' + imageMime(path) + ';base64,' + buf.toString('base64')
        }
        return readFileSync(full, 'utf8')
      } catch {
        return undefined
      }
    },
    tree() {
      return collectTree(cwdOf())
    },
    change(path) {
      const cwd = cwdOf()
      if (cwd.length === 0 || path.length === 0) return undefined
      const after = readWork(cwd, path)
      let before = ''
      try {
        before = defaultGitExec(['show', 'HEAD:' + path], cwd)
      } catch {
        before = ''
      }
      if (before === after) return undefined
      return { before, after }
    },
    stats() {
      return gitRepo.numstat(cwdOf())
    },
  }
}

function imageMime(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function readWork(cwd: string, path: string): string {
  try {
    return readFileSync(join(cwd, path), 'utf8')
  } catch {
    return ''
  }
}
