/** Read-only ReviewPort: 本轮变更 from the 主会话 log, staged/unstaged from cached git. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultGitExec, gitRepo } from './git-status.ts'
import type { ReviewChange, ReviewPort } from './review.ts'

export function createHostReview(opts: {
  cwdOf: () => string
  turnWrites: () => ReviewChange[]
  isBusy: () => boolean
}): ReviewPort {
  return {
    turnWrites: () => opts.turnWrites(),
    workingTree: () => gitRepo.changes(opts.cwdOf()).uncommitted,
    staged: () => gitRepo.changes(opts.cwdOf()).staged,
    unstaged: () => gitRepo.changes(opts.cwdOf()).unstaged,
    branches: () => gitRepo.branches(opts.cwdOf()),
    against: (ref) => gitAgainst(opts.cwdOf(), ref),
    isBusy: () => opts.isBusy(),
  }
}

function gitAgainst(cwd: string, ref: string): ReviewChange[] {
  if (cwd.length === 0 || ref.length === 0 || !gitRepo.inGit(cwd)) return []
  let names = ''
  try {
    names = defaultGitExec(['diff', '--name-only', ref], cwd)
  } catch {
    return []
  }
  const changes: ReviewChange[] = []
  for (const path of names.split('\n')) {
    if (path.length === 0) continue
    let before = ''
    try {
      before = defaultGitExec(['show', ref + ':' + path], cwd)
    } catch {
      before = ''
    }
    let after = ''
    try {
      after = readFileSync(join(cwd, path), 'utf8')
    } catch {
      after = ''
    }
    if (before === after) continue
    changes.push({ path, before, after })
  }
  return changes
}
