import { describe, expect, it } from 'vitest'
import {
  browserStreamCaptureScale,
  decodeBrowserStreamFrame,
  encodeBrowserStreamFrame,
  ManagedBrowserStream,
  MANAGED_BROWSER_STREAM_PATH,
  MANAGED_BROWSER_STREAM_VERSION,
} from '../src/managed-browser-stream.ts'

describe('managed browser stream protocol', () => {
  it('encodes binary JPEG frames without base64', () => {
    const encoded = encodeBrowserStreamFrame({
      version: MANAGED_BROWSER_STREAM_VERSION,
      sequence: 42,
      sentAt: 1_725_000_000_123,
      width: 720,
      height: 860,
      jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    })
    expect(decodeBrowserStreamFrame(encoded)).toEqual({
      version: MANAGED_BROWSER_STREAM_VERSION,
      sequence: 42,
      sentAt: 1_725_000_000_123,
      width: 720,
      height: 860,
      jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    })
  })

  it('rejects frames shorter than the versioned header', () => {
    expect(() => decodeBrowserStreamFrame(new Uint8Array(16))).toThrow('shorter than its header')
  })

  it('uses a bounded high-density capture scale for visible frames', () => {
    expect(browserStreamCaptureScale(720, 860)).toBe(1.5)
    expect(browserStreamCaptureScale(1280, 800)).toBe(1.5)
    expect(browserStreamCaptureScale(1920, 1440)).toBeCloseTo(4 / 3)
    expect(browserStreamCaptureScale(0, 0)).toBe(1)
  })

  it('issues one-use tab-scoped tickets with a TTL', () => {
    let now = 100
    const stream = new ManagedBrowserStream({
      runtime: {} as never,
      now: () => now,
      ticketTtlMs: 50,
    })
    const tab = { sessionId: 's1', tabId: 'b1' }
    const first = stream.issue(tab)
    expect(first.path.startsWith(MANAGED_BROWSER_STREAM_PATH + '?ticket=')).toBe(true)
    expect(first.expiresAt).toBe(150)
    expect(stream.consume(first.ticket)).toEqual(tab)
    expect(stream.consume(first.ticket)).toBeUndefined()

    const expired = stream.issue(tab)
    now = 151
    expect(stream.consume(expired.ticket)).toBeUndefined()
  })
})
