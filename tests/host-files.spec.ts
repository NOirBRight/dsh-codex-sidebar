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
    expect(files.tree().map((node) => node.path)).toEqual(['docs/logo.PNG', 'docs/note.md'])
    rmSync(root, { recursive: true, force: true })
  })
})
