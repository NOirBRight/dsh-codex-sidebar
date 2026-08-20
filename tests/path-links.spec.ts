import { describe, expect, it } from 'vitest'
import { transcriptPath } from '../src/client/path-links.ts'

describe('transcript path links', () => {
  it('accepts relative and absolute workspace paths', () => {
    expect(transcriptPath('generated/grok-imagine-probe.png')).toBe('generated/grok-imagine-probe.png')
    expect(transcriptPath('/home/noirbright/development/generated/grok-imagine-probe.png')).toBe(
      '/home/noirbright/development/generated/grok-imagine-probe.png',
    )
    expect(transcriptPath('./src/client/FilesPane.tsx')).toBe('./src/client/FilesPane.tsx')
  })

  it('rejects URLs, commands, and plain words', () => {
    expect(transcriptPath('https://example.com/x.png')).toBeUndefined()
    expect(transcriptPath('git status')).toBeUndefined()
    expect(transcriptPath('flutter')).toBeUndefined()
  })
})
