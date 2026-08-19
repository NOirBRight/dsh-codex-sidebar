import { describe, expect, it } from 'vitest'
import { browserStreamSignalsReady, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame } from '../src/client/managed-browser-stream.ts'
import { encodeBrowserStreamFrame } from '../src/managed-browser-stream.ts'

describe('managed Browser stream client', () => {
  it('decodes the host binary frame and derives same-origin ws URLs', () => {
    const encoded = encodeBrowserStreamFrame({
      version: 1,
      sequence: 3,
      sentAt: 42,
      width: 640,
      height: 480,
      jpeg: new Uint8Array([1, 2, 3]),
    })
    const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    expect(decodeBrowserFrame(buffer)).toEqual({
      version: 1,
      sequence: 3,
      sentAt: 42,
      width: 640,
      height: 480,
      jpeg: new Uint8Array([1, 2, 3]),
    })
    expect(browserWebSocketUrl('/cast', { protocol: 'http:', host: '127.0.0.1:3082' } as Location)).toBe('ws://127.0.0.1:3082/cast')
    expect(browserWebSocketUrl('/cast', { protocol: 'https:', host: 'lab.example' } as Location)).toBe('wss://lab.example/cast')
  })



  it('removes the Connecting overlay when a frame or ready projection arrives', () => {
    expect(browserStreamSignalsReady(new ArrayBuffer(17))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'ready' }))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'state', projection: { status: 'ready' } }))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'state', projection: { status: 'loading' } }))).toBe(false)
    expect(browserStreamSignalsReady('not json')).toBe(false)
  })

  it('sends only the latest move and accumulates one wheel per animation frame', () => {
    const sent: Array<Record<string, unknown>> = []
    let frame: (() => void) | undefined
    const queue = createBrowserInputCoalescer(
      (input) => { sent.push(input) },
      (flush) => { frame = flush; return 1 },
      () => {},
    )
    queue.push({ type: 'move', x: 1, y: 1 })
    queue.push({ type: 'move', x: 3, y: 4, pressed: true })
    queue.push({ type: 'wheel', x: 3, y: 4, deltaX: 2, deltaY: 10 })
    queue.push({ type: 'wheel', x: 3, y: 5, deltaX: -1, deltaY: 5 })
    expect(sent).toEqual([])
    frame?.()
    expect(sent).toEqual([
      { type: 'move', x: 3, y: 4, pressed: true },
      { type: 'wheel', x: 3, y: 5, deltaX: 1, deltaY: 15 },
    ])
  })
})
