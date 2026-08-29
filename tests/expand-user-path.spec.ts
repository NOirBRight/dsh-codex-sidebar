import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandUserPath, readPreview } from '../src/workspace-inspector.ts'

afterEach(() => { vi.unstubAllEnvs() })

describe('expandUserPath', () => {
  it('expands ~/ to the host home so Files can read transcript paths', () => {
    expect(expandUserPath('~/Workstation/dsh-launchers/bin/dsh-lib.sh')).toBe(
      join(homedir(), 'Workstation/dsh-launchers/bin/dsh-lib.sh'),
    )
    expect(expandUserPath('~')).toBe(homedir())
    expect(expandUserPath('/tmp/a.ts')).toBe('/tmp/a.ts')
  })
})

describe('readPreview', () => {
  it('reads a real file addressed with ~/', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dcs-home-'))
    const path = join(home, 'transcript.md')
    await writeFile(path, 'alpha transcript\n', 'utf8')
    vi.stubEnv('HOME', home)

    await expect(readPreview('/tmp', '~/transcript.md')).resolves.toBe('alpha transcript\n')
  })
})
