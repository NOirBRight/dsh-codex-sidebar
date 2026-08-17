/** Read-only ReviewPort: 本轮变更 from the 主会话 log, working tree from git. */

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
    workingTree: () => readWorkingTree(opts.cwdOf()),
    isBusy: () => opts.isBusy(),
  }
}

function readWorkingTree(cwd: string): ReviewChange[] {
  if (cwd.length === 0) return []
  let porcelain: string
  try {
    porcelain = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return []
  }
  const changes: ReviewChange[] = []
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue
    const path = porcelainPath(raw.slice(3))
    if (path.length === 0) continue
    const code = raw.slice(0, 2)
    const untracked = code === '??'
    const deleted = code.includes('D')
    const before = untracked ? '' : gitShow(cwd, path)
    const after = deleted ? '' : readWork(cwd, path)
    if (before === after) continue
    changes.push({ path, before, after })
  }
  return changes
}

function porcelainPath(rest: string): string {
  const renamed = rest.includes(' -> ')
  const side = renamed ? rest.slice(rest.lastIndexOf(' -> ') + 4) : rest
  return side.replace(/^"(.*)"$/, '$1')
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
