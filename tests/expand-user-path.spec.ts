import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandUserPath, readPreview } from '../src/workspace-inspector.ts'

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
    const text = await readPreview('/tmp', '~/Workstation/dsh-launchers/bin/dsh-lib.sh')
    expect(text).toContain('apply_ime_env')
  })
})
