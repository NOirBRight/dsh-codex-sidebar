/** Bounded workspace listing: breadth-first, fair per-directory cap. */

import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { TreeNode } from './session.ts'

export const MAX_TREE_NODES = 400
const PER_DIR = 80
export const SKIP_WALK = new Set([
  'node_modules', '.git', 'dist', 'lib', 'coverage', '.next', '.cache',
  'out', 'build', 'target', 'third_party', '.dart_tool', '.pnpm', '__pycache__', 'vendor',
])
export const SKIP_SHOW = new Set(['.git'])
export const SHOW_COLLAPSED = new Set(['node_modules', 'out', 'build', 'third_party', '.dart_tool', 'vendor'])

export function collectTree(root: string, signal?: AbortSignal): TreeNode[] {
  if (root.length === 0) return []
  const nodes: TreeNode[] = []
  const queue: string[] = [root]
  while (queue.length > 0 && nodes.length < MAX_TREE_NODES) {
    signal?.throwIfAborted()
    const dir = queue.shift()
    if (dir === undefined) break
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const subdirs: string[] = []
    let addedHere = 0
    for (const entry of entries) {
      if (nodes.length >= MAX_TREE_NODES) break
      if (SKIP_SHOW.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = relative(root, full).split(sep).join('/')
      if (entry.isDirectory()) {
        if (SKIP_WALK.has(entry.name)) {
          if (SHOW_COLLAPSED.has(entry.name)) nodes.push({ path: rel, name: entry.name, kind: 'dir' })
          continue
        }
        subdirs.push(full)
        continue
      }
      if (!entry.isFile()) continue
      if (addedHere >= PER_DIR) continue
      nodes.push({ path: rel, name: entry.name })
      addedHere += 1
    }
    if (addedHere === 0 && subdirs.length === 0 && dir !== root) {
      const name = relative(root, dir).split(sep).pop() ?? dir
      nodes.push({ path: relative(root, dir).split(sep).join('/'), name, kind: 'dir' })
    }
    for (const sub of subdirs) {
      if (nodes.length >= MAX_TREE_NODES) break
      queue.push(sub)
    }
  }
  return nodes
}
