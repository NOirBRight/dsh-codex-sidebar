import { describe, expect, it } from 'vitest'
import { browserAnnotationHighlightRects, browserAnnotationNodeAt, browserSelectedRectForOutline, browserStreamFitSurface, browserStreamFrameBuffer, browserStreamShouldRun, browserStreamSignalsReady, browserStreamTextMessage, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserJpegJson, decodeBrowserOutline, decodeBrowserTrackedRect, updateBrowserSelectedRect } from '../src/client/managed-browser-stream.ts'
import { encodeBrowserStreamFrame, encodeBrowserStreamJsonFrame } from '../src/managed-browser-stream.ts'

describe('managed Browser stream client', () => {
  it('letterboxes a desktop JPEG into a phone sidebar without stretching', () => {
    const surface = browserStreamFitSurface({ width: 390, height: 600 }, { width: 720, height: 860 })
    expect(surface.width / surface.height).toBeCloseTo(720 / 860, 2)
    expect(surface.width).toBeLessThanOrEqual(390)
    expect(surface.height).toBeLessThanOrEqual(600)
  })

  it('pauses the live stream when the page is hidden or the canvas is offscreen', () => {
    expect(browserStreamShouldRun(true, true)).toBe(true)
    expect(browserStreamShouldRun(false, true)).toBe(false)
    expect(browserStreamShouldRun(true, false)).toBe(false)
  })
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
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'frame', version: 1, jpeg: 'abc' }))).toBe(true)
  })

  it('decodes JSON JPEG frames that DSH Mobile delivers as strings', () => {
    const encoded = encodeBrowserStreamJsonFrame({
      version: 1,
      sequence: 9,
      sentAt: 12,
      width: 720,
      height: 860,
      jpeg: new Uint8Array([0xff, 0xd8, 9, 8, 0xff, 0xd9]),
    })
    expect(browserStreamTextMessage(encoded)).toBe(encoded)
    expect(decodeBrowserJpegJson(encoded)).toEqual({
      version: 1,
      sequence: 9,
      sentAt: 12,
      width: 720,
      height: 860,
      jpeg: new Uint8Array([0xff, 0xd8, 9, 8, 0xff, 0xd9]),
    })
  })

  it('recovers JPEG frames that an APP WebView delivers as binary strings', () => {
    const encoded = encodeBrowserStreamFrame({
      version: 1,
      sequence: 3,
      sentAt: 42,
      width: 640,
      height: 480,
      jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    })
    const binaryString = Array.from(encoded, (byte) => String.fromCharCode(byte)).join('')
    const recovered = browserStreamFrameBuffer(binaryString)
    expect(recovered).toBeInstanceOf(ArrayBuffer)
    expect(decodeBrowserFrame(recovered as ArrayBuffer).jpeg).toEqual(new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]))
    expect(browserStreamTextMessage(binaryString)).toBeUndefined()
    expect(browserStreamTextMessage(JSON.stringify({ type: 'ready' }))).toBe('{"type":"ready"}')
    expect(browserStreamFrameBuffer(JSON.stringify({ type: 'ready' }))).toBeUndefined()
  })



  it('decodes Browser outlines and selects the smallest element under the pointer', () => {
    const outline = decodeBrowserOutline(JSON.stringify({
      type: 'outline',
      documentId: 's1:b1:d1',
      nodes: [
        { ref: '@d1e1', role: 'link', name: 'Outer', selector: 'a', rect: { x: 10, y: 10, w: 100, h: 80 } },
        { ref: '@d1e2', role: 'button', name: 'Inner', selector: 'button', rect: { x: 20, y: 20, w: 30, h: 20 } },
      ],
    }))
    expect(outline?.documentId).toBe('s1:b1:d1')
    expect(browserAnnotationNodeAt(outline?.nodes ?? [], { x: 25, y: 25 })?.selector).toBe('button')
    expect(browserAnnotationNodeAt(outline?.nodes ?? [], { x: 200, y: 200 })).toBeUndefined()
  })



  it('keeps the selected annotation rect after the pointer leaves its target', () => {
    const selected = { x: 40, y: 60, w: 120, h: 32 }
    expect(browserAnnotationHighlightRects(selected, null).selected).toEqual(selected)
    expect(browserAnnotationHighlightRects(selected, { x: 200, y: 200, w: 20, h: 20 }).selected).toEqual(selected)
  })



  it('keeps selected and hovered element highlights visible at the same time', () => {
    const selected = { x: 40, y: 300, w: 120, h: 32 }
    const hovered = { x: 200, y: 420, w: 90, h: 24 }
    expect(browserAnnotationHighlightRects(selected, hovered)).toEqual({ selected, hovered })
    expect(browserAnnotationHighlightRects(selected, selected)).toEqual({ selected, hovered: null })
  })

  it('waits for the measured target rect instead of predicting scroll at a boundary', () => {
    const selected = { x: 40, y: 300, w: 120, h: 32 }
    expect(updateBrowserSelectedRect(selected, { type: 'wheel' })).toEqual(selected)
    const tracked = decodeBrowserTrackedRect(JSON.stringify({
      type: 'tracked-rect', documentId: 's1:b1:d1', selector: '#target', rect: selected,
    }))
    expect(tracked?.rect).toEqual(selected)
    expect(updateBrowserSelectedRect(selected, { type: 'tracked', rect: { x: 40, y: 216, w: 120, h: 32 } })).toEqual({ x: 40, y: 216, w: 120, h: 32 })
    expect(browserSelectedRectForOutline('#target', [])).toBeNull()
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
