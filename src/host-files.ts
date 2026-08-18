/** Read-only workspace FilesPort backed by the 主会话 cwd. */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
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
    change(path) {
      const cwd = cwdOf()
      if (cwd.length === 0 || path.length === 0) return undefined
      const after = readWork(cwd, path)
      const before = gitShow(cwd, path)
      if (before === after) return undefined
      return { before, after }
    },
    stats() {
      return gitNumstat(cwdOf())
    },
  }
}

function gitNumstat(cwd: string): Record<string, { added: number; removed: number }> {
  if (cwd.length === 0) return {}
  let text = ''
  try {
    text = execFileSync('git', ['diff', '--numstat', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return {}
  }
  const out: Record<string, { added: number; removed: number }> = {}
  for (const line of text.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (match === null) continue
    const path = numstatPath(match[3] ?? '')
    if (path.length === 0) continue
    out[path] = {
      added: match[1] === '-' ? 0 : Number(match[1]),
      removed: match[2] === '-' ? 0 : Number(match[2]),
    }
  }
  try {
    const extra = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const path of extra.split('\n')) {
      if (path.length === 0 || out[path] !== undefined) continue
      if (path === 'node_modules' || path.startsWith('node_modules/')) continue
      out[path] = { added: lineCount(readWork(cwd, path)), removed: 0 }
    }
  } catch {
    // not a git repo, or no untracked files
  }
  return out
}

function numstatPath(raw: string): string {
  const renamed = raw.includes(' => ')
  const side = renamed ? raw.slice(raw.lastIndexOf(' => ') + 4) : raw
  return side.replace(/^"(.*)"$/, '$1')
}

function lineCount(text: string): number {
  if (text.length === 0) return 0
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.length
}

function gitShow(cwd: string, path: string): string {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

function readWork(cwd: string, path: string): string {
  try {
    return readFileSync(join(cwd, path), 'utf8')
  } catch {
    return ''
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
