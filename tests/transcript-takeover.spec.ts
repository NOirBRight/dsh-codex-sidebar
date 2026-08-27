import { describe, expect, it } from 'vitest'
import { allowTranscriptTakeover, installTranscriptClickCapture } from '../src/transcript-takeover.ts'

describe('主会话 transcript takeover', () => {
  it('installs URL interception on both window and document capture roots', () => {
    const calls: string[] = []
    const root = (name: string) => ({
      addEventListener(type: 'click', _listener: (event: unknown) => void, capture: true) {
        calls.push(name + ':' + type + ':' + String(capture))
      },
    })
    installTranscriptClickCapture([root('window'), root('document')], () => {})
    expect(calls).toEqual(['window:click:true', 'document:click:true'])
  })

  it('ignores 侧栏 chrome and non-center columns', () => {
    expect(allowTranscriptTakeover((selector) => selector.includes('.dcs-root') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="details"]') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="sidebar"]') ? {} : null)).toBe(false)
    expect(allowTranscriptTakeover((selector) => selector.includes('[data-side="center"]') ? {} : null)).toBe(true)
    expect(allowTranscriptTakeover(() => null)).toBe(true)
  })
})
