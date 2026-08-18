import { describe, expect, it } from 'vitest'
import { allowTranscriptTakeover } from '../src/transcript-takeover.ts'

describe('主会话 transcript takeover', () => {
  it('ignores 侧栏 chrome and non-center columns', () => {
    expect(allowTranscriptTakeover((selector) => selector.includes('.dcs-root') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="details"]') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="sidebar"]') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="center"]') ? {} : null)).toBe(true)
    expect(allowTranscriptTakeover(() => null)).toBe(true)
  })
})
