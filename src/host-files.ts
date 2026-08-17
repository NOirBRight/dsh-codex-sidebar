/** Read-only workspace FilesPort backed by the 主会话 cwd. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { FilesPort, TreeNode } from './session.ts'

const SKIP = new Set(['node_modules', '.git', 'dist', 'lib', 'coverage', '.next', '.cache'])
const MAX_FILES = 400

export function createFsFiles(cwdOf: () => string): FilesPort {
  return {
    read(path) {
      const cwd = cwdOf()
      if (cwd.length === 0) return undefined
      try {
        const full = join(cwd, path)
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
          const buf = readFileSync(full)
          return `data:${imageMime(path)};base64,${buf.toString('base64')}`
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
    if (SKIP.has(name) || name.startsWith('.')) continue
    const full = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walk(root, full, nodes)
      continue
    }
    const rel = relative(root, full).split(sep).join('/')
    nodes.push({ path: rel, name })
  }
}
