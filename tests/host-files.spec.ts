import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsFiles } from '../src/host-files.ts'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('host Files', () => {
  it('returns image bytes as a data URL and markdown as utf8', () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-files-'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'logo.PNG'), PNG)
    writeFileSync(join(root, 'docs', 'note.md'), '# Title\n')
    const files = createFsFiles(() => root)
    expect(files.read('docs/logo.PNG')).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(files.read('docs/note.md')).toBe('# Title\n')
    expect(files.read(join(root, 'docs', 'note.md'))).toBe('# Title\n')
    expect(files.tree().map((node) => node.path)).toEqual(['docs/logo.PNG', 'docs/note.md'])
    rmSync(root, { recursive: true, force: true })
  })

  it('lists dotfiles and a collapsed node_modules folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-files-'))
    writeFileSync(join(root, '.gitignore'), 'lib\n')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'skip.js'), 'nope')
    mkdirSync(join(root, '.scratch'))
    writeFileSync(join(root, '.scratch', 'note.md'), '# x\n')
    const files = createFsFiles(() => root)
    const tree = files.tree()
    expect(tree).toContainEqual({ path: '.gitignore', name: '.gitignore' })
    expect(tree).toContainEqual({ path: 'node_modules', name: 'node_modules', kind: 'dir' })
    expect(tree.some((node) => node.path.startsWith('node_modules/'))).toBe(false)
    expect(tree).toContainEqual({ path: '.scratch/note.md', name: 'note.md' })
    rmSync(root, { recursive: true, force: true })
  })

  it('counts tracked diffs and untracked files in stats()', () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-stats-'))
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: root, stdio: 'ignore' })
    writeFileSync(join(root, 'kept.ts'), 'a\n')
    execFileSync('git', ['add', 'kept.ts'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' })
    writeFileSync(join(root, 'kept.ts'), 'a\nb\n')
    writeFileSync(join(root, 'fresh.ts'), 'one\ntwo\n')
    const files = createFsFiles(() => root)
    expect(files.stats?.()).toEqual({
      'kept.ts': { added: 1, removed: 0 },
      'fresh.ts': { added: 2, removed: 0 },
    })
    rmSync(root, { recursive: true, force: true })
  })
})
