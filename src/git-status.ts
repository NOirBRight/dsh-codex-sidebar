/** One git status per repo generation. Shared by Files stats and Review. */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewChange } from './review.ts'

export type GitExec = (args: readonly string[], cwd: string) => string

export type GitEntry = {
  path: string
  x: string
  y: string
  untracked: boolean
}

export type GitRepoStatus = {
  inside: boolean
  branch: string
  entries: GitEntry[]
}

export type GitChanges = {
  uncommitted: ReviewChange[]
  staged: ReviewChange[]
  unstaged: ReviewChange[]
}

const TTL_MS = 1500

type Cache = {
  gen: string
  at: number
  status: GitRepoStatus
  changes?: GitChanges
  numstat?: Record<string, { added: number; removed: number }>
  branches?: { current: string; names: string[] }
}

export function defaultGitExec(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

export function createGitRepo(exec: GitExec = defaultGitExec): {
  status(cwd: string): GitRepoStatus
  changes(cwd: string): GitChanges
  numstat(cwd: string): Record<string, { added: number; removed: number }>
  branches(cwd: string): { current: string; names: string[] }
  inGit(cwd: string): boolean
  execCount(): number
  clear(): void
} {
  const cache = new Map<string, Cache>()
  let execs = 0

  function run(args: readonly string[], cwd: string): string {
    execs += 1
    return exec(args, cwd)
  }

  function load(cwd: string): Cache {
    const gen = generation(cwd)
    const now = Date.now()
    const hit = cache.get(cwd)
    if (hit !== undefined && hit.gen === gen && now - hit.at < TTL_MS) return hit
    const status = readStatus(run, cwd)
    const next: Cache = { gen, at: now, status }
    cache.set(cwd, next)
    return next
  }

  return {
    execCount: () => execs,
    clear() {
      cache.clear()
      execs = 0
    },
    status(cwd) {
      if (cwd.length === 0) return emptyStatus()
      return load(cwd).status
    },
    inGit(cwd) {
      return cwd.length > 0 && load(cwd).status.inside
    },
    changes(cwd) {
      if (cwd.length === 0) return emptyChanges()
      const rec = load(cwd)
      if (rec.changes !== undefined) return rec.changes
      rec.changes = buildChanges(run, cwd, rec.status)
      return rec.changes
    },
    numstat(cwd) {
      if (cwd.length === 0) return {}
      const rec = load(cwd)
      if (rec.numstat !== undefined) return rec.numstat
      rec.numstat = buildNumstat(run, cwd, rec.status)
      return rec.numstat
    },
    branches(cwd) {
      if (cwd.length === 0) return { current: '', names: [] }
      const rec = load(cwd)
      if (rec.branches !== undefined) return rec.branches
      rec.branches = buildBranches(run, cwd, rec.status)
      return rec.branches
    },
  }
}

export const gitRepo = createGitRepo()

function emptyStatus(): GitRepoStatus {
  return { inside: false, branch: '', entries: [] }
}

function emptyChanges(): GitChanges {
  return { uncommitted: [], staged: [], unstaged: [] }
}

function generation(cwd: string): string {
  try {
    return String(statSync(join(cwd, '.git', 'HEAD')).mtimeMs)
  } catch {
    return 'none'
  }
}

function readStatus(run: (args: readonly string[], cwd: string) => string, cwd: string): GitRepoStatus {
  let raw = ''
  try {
    raw = run(['status', '--porcelain=v2', '--branch', '-z'], cwd)
  } catch {
    return emptyStatus()
  }
  let branch = ''
  const entries: GitEntry[] = []
  for (const rec of raw.split('\0')) {
    if (rec.length === 0) continue
    if (rec.startsWith('# branch.head ')) {
      const name = rec.slice('# branch.head '.length).trim()
      if (name !== '(detached)') branch = name
      continue
    }
    if (rec.startsWith('? ')) {
      entries.push({ path: rec.slice(2), x: '?', y: '?', untracked: true })
      continue
    }
    if (rec.startsWith('1 ') || rec.startsWith('2 ')) {
      const parsed = parseTracked(rec)
      if (parsed !== undefined) entries.push(parsed)
    }
  }
  return { inside: true, branch, entries }
}

function parseTracked(rec: string): GitEntry | undefined {
  const parts = rec.split(' ')
  if (parts.length < 9) return undefined
  const xy = parts[1] ?? ''
  if (xy.length < 2) return undefined
  const pathField = rec.startsWith('2 ') ? rec.slice(rec.lastIndexOf(' ') + 1) : (parts[8] ?? '')
  const path = pathField.includes('\t') ? pathField.slice(pathField.indexOf('\t') + 1) : pathField
  if (path.length === 0) return undefined
  return { path, x: xy[0] ?? '.', y: xy[1] ?? '.', untracked: false }
}

function buildChanges(
  run: (args: readonly string[], cwd: string) => string,
  cwd: string,
  status: GitRepoStatus,
): GitChanges {
  if (!status.inside) return emptyChanges()
  const uncommitted: ReviewChange[] = []
  const staged: ReviewChange[] = []
  const unstaged: ReviewChange[] = []
  for (const entry of status.entries) {
    if (entry.untracked) {
      const work = readWork(cwd, entry.path)
      pushChange(unstaged, entry.path, '', work)
      pushChange(uncommitted, entry.path, '', work)
      continue
    }
    const head = gitShow(run, cwd, 'HEAD:' + entry.path)
    const index = gitShow(run, cwd, ':' + entry.path)
    const work = entry.y === 'D' ? '' : readWork(cwd, entry.path)
    if (entry.x !== '.' && entry.x !== '?') {
      pushChange(staged, entry.path, head, entry.x === 'D' ? '' : index)
    }
    if (entry.y !== '.' && entry.y !== '?') {
      const before = index.length > 0 ? index : head
      pushChange(unstaged, entry.path, before, entry.y === 'D' ? '' : work)
    }
    const workAfter = (entry.x === 'D' && entry.y === '.') || entry.y === 'D' ? '' : work
    pushChange(uncommitted, entry.path, head, workAfter)
  }
  return { uncommitted, staged, unstaged }
}

function buildNumstat(
  run: (args: readonly string[], cwd: string) => string,
  cwd: string,
  status: GitRepoStatus,
): Record<string, { added: number; removed: number }> {
  const out: Record<string, { added: number; removed: number }> = {}
  if (!status.inside) return out
  let text = ''
  try {
    text = run(['diff', '--numstat', 'HEAD'], cwd)
  } catch {
    text = ''
  }
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
  for (const entry of status.entries) {
    if (!entry.untracked || out[entry.path] !== undefined) continue
    if (entry.path === 'node_modules' || entry.path.startsWith('node_modules/')) continue
    out[entry.path] = { added: 0, removed: 0 }
  }
  return out
}

function buildBranches(
  run: (args: readonly string[], cwd: string) => string,
  cwd: string,
  status: GitRepoStatus,
): { current: string; names: string[] } {
  if (!status.inside) return { current: '', names: [] }
  try {
    const text = run(['branch', '--format=%(refname:short)\t%(HEAD)'], cwd)
    const names: string[] = []
    let current = status.branch
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const tab = line.indexOf('\t')
      const name = tab === -1 ? line : line.slice(0, tab)
      const head = tab === -1 ? '' : line.slice(tab + 1)
      if (name.length === 0) continue
      names.push(name)
      if (head === '*') current = name
    }
    return { current, names }
  } catch {
    return { current: status.branch, names: status.branch.length === 0 ? [] : [status.branch] }
  }
}

function gitShow(run: (args: readonly string[], cwd: string) => string, cwd: string, spec: string): string {
  try {
    return run(['show', spec], cwd)
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

function pushChange(into: ReviewChange[], path: string, before: string, after: string): void {
  if (before === after) return
  into.push({ path, before, after })
}

function numstatPath(raw: string): string {
  const renamed = raw.includes(' => ')
  const side = renamed ? raw.slice(raw.lastIndexOf(' => ') + 4) : raw
  return side.replace(/^"(.*)"$/, '$1')
}
