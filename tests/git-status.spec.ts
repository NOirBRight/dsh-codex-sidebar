import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGitRepo } from '../src/git-status.ts'

function initRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dcs-git-'))
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root, stdio: 'ignore' })
  writeFileSync(join(root, 'kept.ts'), 'a\n')
  execFileSync('git', ['add', 'kept.ts'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' })
  return root
}

describe('git status cache', () => {
  it('reuses one porcelain status for stats and Review bags', () => {
    const root = initRepo()
    writeFileSync(join(root, 'kept.ts'), 'a\nb\n')
    writeFileSync(join(root, 'fresh.ts'), 'x\n')
    const repo = createGitRepo()
    const first = repo.numstat(root)
    const bags = repo.changes(root)
    expect(first['kept.ts']).toEqual({ added: 1, removed: 0 })
    expect(first['fresh.ts']).toEqual({ added: 0, removed: 0 })
    expect(bags.unstaged.some((item) => item.path === 'kept.ts')).toBe(true)
    const after = repo.execCount()
    repo.numstat(root)
    repo.changes(root)
    expect(repo.execCount()).toBe(after)
    rmSync(root, { recursive: true, force: true })
  })
})
