/** Read-only ReviewPort: 本轮变更 from the 主会话 log, staged/unstaged from git. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewChange, ReviewPort } from './review.ts'

export function createHostReview(opts: {
  cwdOf: () => string
  turnWrites: () => ReviewChange[]
  isBusy: () => boolean
}): ReviewPort {
  return {
    turnWrites: () => opts.turnWrites(),
    workingTree: () => gitChanges(opts.cwdOf()).uncommitted,
    staged: () => gitChanges(opts.cwdOf()).staged,
    unstaged: () => gitChanges(opts.cwdOf()).unstaged,
    branches: () => gitBranches(opts.cwdOf()),
    against: (ref) => gitAgainst(opts.cwdOf(), ref),
    isBusy: () => opts.isBusy(),
  }
}

function gitChanges(cwd: string): { uncommitted: ReviewChange[]; staged: ReviewChange[]; unstaged: ReviewChange[] } {
  const empty = { uncommitted: [], staged: [], unstaged: [] }
  if (cwd.length === 0 || !inGit(cwd)) return empty
  let porcelain = ''
  try {
    porcelain = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return empty
  }
  const uncommitted: ReviewChange[] = []
  const staged: ReviewChange[] = []
  const unstaged: ReviewChange[] = []
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue
    const path = porcelainPath(raw.slice(3))
    if (path.length === 0) continue
    const x = raw[0] ?? ' '
    const y = raw[1] ?? ' '
    const untracked = raw.startsWith('??')
    const head = untracked ? '' : gitBlob(cwd, `HEAD:${path}`)
    const index = untracked ? '' : gitBlob(cwd, `:${path}`)
    const work = raw.includes('D') && y === 'D' ? '' : readWork(cwd, path)
    if (untracked) {
      pushChange(unstaged, path, '', work)
      pushChange(uncommitted, path, '', work)
      continue
    }
    if (x !== ' ' && x !== '?') {
      const after = x === 'D' ? '' : index
      pushChange(staged, path, head, after)
    }
    if (y !== ' ' && y !== '?') {
      const before = index.length > 0 ? index : head
      const after = y === 'D' ? '' : work
      pushChange(unstaged, path, before, after)
    }
    const workAfter = (x === 'D' && y === ' ') || y === 'D' ? '' : work
    pushChange(uncommitted, path, head, workAfter)
  }
  return { uncommitted, staged, unstaged }
}

function pushChange(into: ReviewChange[], path: string, before: string, after: string): void {
  if (before === after) return
  into.push({ path, before, after })
}

function gitBranches(cwd: string): { current: string; names: string[] } {
  if (cwd.length === 0 || !inGit(cwd)) return { current: '', names: [] }
  try {
    const text = execFileSync('git', ['branch', '--format=%(refname:short)\t%(HEAD)'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const names: string[] = []
    let current = ''
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
    return { current: '', names: [] }
  }
}

function gitAgainst(cwd: string, ref: string): ReviewChange[] {
  if (cwd.length === 0 || ref.length === 0 || !inGit(cwd)) return []
  let names = ''
  try {
    names = execFileSync('git', ['diff', '--name-only', ref], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  const changes: ReviewChange[] = []
  for (const path of names.split('\n')) {
    if (path.length === 0) continue
    pushChange(changes, path, gitBlob(cwd, `${ref}:${path}`), readWork(cwd, path))
  }
  return changes
}

function inGit(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function porcelainPath(rest: string): string {
  const renamed = rest.includes(' -> ')
  const side = renamed ? rest.slice(rest.lastIndexOf(' -> ') + 4) : rest
  return side.replace(/^"(.*)"$/, '$1')
}

function gitBlob(cwd: string, spec: string): string {
  try {
    return execFileSync('git', ['show', spec], {
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
