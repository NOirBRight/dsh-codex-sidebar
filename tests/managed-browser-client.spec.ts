import { describe, expect, it } from 'vitest'
import { browserAnnotationHighlightRects, browserAnnotationNodeAt, browserBinaryFrameSequence, browserJsonFrameSequence, browserPointerShouldFocusIme, browserSelectedRectForOutline, browserStreamFitSurface, browserStreamFrameBuffer, browserStreamHello, browserStreamReady, browserStreamShouldRun, browserStreamSignalsReady, browserStreamTextMessage, browserTouchGestureMove, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserJpegJson, decodeBrowserOutline, decodeBrowserTrackedRect, paintBrowserFrameForConnection, updateBrowserSelectedRect } from '../src/client/managed-browser-stream.ts'
import { encodeBrowserStreamFrame, encodeBrowserStreamJsonFrame } from '../src/managed-browser-stream.ts'

describe('managed Browser stream client', () => {
  it('offers both frame carriers and frame ACK flow control in hello', () => {
    expect(browserStreamHello()).toEqual({
      type: 'hello',
      version: 1,
      frameEncodings: ['binary-v1', 'json-base64-v1'],
      flowControl: ['frame-ack-v1'],
    })
    expect(browserStreamReady(JSON.stringify({ type: 'ready', version: 1, frameEncoding: 'binary-v1', flowControl: 'frame-ack-v1' }))).toEqual({
      frameEncoding: 'binary-v1',
      flowControl: 'frame-ack-v1',
    })
    expect(browserStreamReady(JSON.stringify({ type: 'ready', version: 1 }))).toBeUndefined()
  })

  it('ACKs only after Canvas paint settles and also ACKs a decode failure', async () => {
    const events: string[] = []
    let finish: ((value: string) => void) | undefined
    const painting = paintBrowserFrameForConnection(
      7,
      () => new Promise<string>((resolve) => { finish = resolve }),
      () => true,
      (value) => { events.push('paint:' + value) },
      (value) => { events.push('dispose:' + value) },
      (sequence) => { events.push('ack:' + sequence) },
    )
    expect(events).toEqual([])
    finish?.('bitmap')
    await painting
    expect(events).toEqual(['paint:bitmap', 'dispose:bitmap', 'ack:7'])

    await expect(paintBrowserFrameForConnection(
      8,
      async () => { throw new Error('bad jpeg') },
      () => true,
      () => { throw new Error('must not paint') },
      () => { throw new Error('must not dispose') },
      (sequence) => { events.push('ack:' + sequence) },
    )).rejects.toThrow('bad jpeg')
    expect(events.at(-1)).toBe('ack:8')
    const truncated = new ArrayBuffer(5)
    new DataView(truncated).setUint32(1, 9)
    expect(browserBinaryFrameSequence(truncated)).toBe(9)
    expect(browserJsonFrameSequence('{"type":"frame","sequence":10,"jpeg":"bad"}')).toBe(10)
  })

  it('drops a delayed decode after reconnect without painting or ACKing the new socket', async () => {
    const oldAcks: number[] = []
    const newAcks: number[] = []
    const paints: string[] = []
    const disposals: string[] = []
    let activeConnection = 'old'
    let finishDecode: ((value: string) => void) | undefined
    const work = paintBrowserFrameForConnection(
      11,
      () => new Promise<string>((resolve) => { finishDecode = resolve }),
      () => activeConnection === 'old',
      (value) => { paints.push(value) },
      (value) => { disposals.push(value) },
      (sequence) => {
        if (activeConnection === 'old') oldAcks.push(sequence)
        else newAcks.push(sequence)
      },
    )

    activeConnection = 'new'
    finishDecode?.('old bitmap')
    await work

    expect(paints).toEqual([])
    expect(disposals).toEqual(['old bitmap'])
    expect(oldAcks).toEqual([])
    expect(newAcks).toEqual([])
  })

  it('letterboxes a desktop JPEG into a phone sidebar without stretching', () => {
    const surface = browserStreamFitSurface({ width: 390, height: 600 }, { width: 720, height: 860 })
    expect(surface.width / surface.height).toBeCloseTo(720 / 860, 2)
    expect(surface.width).toBeLessThanOrEqual(390)
    expect(surface.height).toBeLessThanOrEqual(600)
  })

  it('does not focus the hidden IME for touch taps', () => {
    expect(browserPointerShouldFocusIme('touch')).toBe(false)
    expect(browserPointerShouldFocusIme('mouse')).toBe(true)
  })

  it('turns a touch drag into wheel deltas but keeps a small move as a tap', () => {
    const small = browserTouchGestureMove({ startX: 100, startY: 200, lastX: 100, lastY: 200, moved: false }, 103, 204)
    expect(small.moved).toBe(false)
    expect(small.deltaY).toBe(-4)
    const drag = browserTouchGestureMove(small.gesture, 103, 170)
    expect(drag.moved).toBe(true)
    expect(drag.deltaY).toBe(34)
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
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'ready', version: 1, frameEncoding: 'binary-v1', flowControl: 'frame-ack-v1' }))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'ready' }))).toBe(false)
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
