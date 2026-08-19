/** Read-only workspace FilesPort backed by the 主会话 cwd. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { defaultGitExec, gitRepo } from './git-status.ts'
import type { FilesPort, TreeNode } from './session.ts'

const SKIP_WALK = new Set(['node_modules', '.git', 'dist', 'lib', 'coverage', '.next', '.cache'])
const SKIP_SHOW = new Set(['.git'])
const SHOW_COLLAPSED = new Set(['node_modules'])
const MAX_FILES = 400

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
      const cwd = cwdOf()
      if (cwd.length === 0) return []
      const nodes: TreeNode[] = []
      walk(cwd, cwd, nodes)
      return nodes
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

function walk(root: string, dir: string, nodes: TreeNode[]): void {
  if (nodes.length >= MAX_FILES) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries.sort()) {
    if (nodes.length >= MAX_FILES) return
    if (SKIP_SHOW.has(name)) continue
    const full = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    const rel = relative(root, full).split(sep).join('/')
    if (isDir) {
      if (SKIP_WALK.has(name)) {
        if (SHOW_COLLAPSED.has(name)) nodes.push({ path: rel, name, kind: 'dir' })
        continue
      }
      const before = nodes.length
      walk(root, full, nodes)
      if (nodes.length === before) nodes.push({ path: rel, name, kind: 'dir' })
      continue
    }
    nodes.push({ path: rel, name })
  }
}
