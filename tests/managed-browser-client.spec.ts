import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserVisibilityGrace, browserAnnotationHighlightRects, browserAnnotationNodeAt, browserBinaryFrameIdentity, browserJsonFrameIdentity, browserPointerShouldFocusIme, browserSelectedRectForOutline, browserStreamFitSurface, browserStreamFrameBuffer, browserStreamHello, browserStreamReady, browserStreamShouldRun, browserStreamSignalsReady, browserStreamTextMessage, browserTouchGestureMove, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserJpegJson, decodeBrowserLayoutCommit, decodeBrowserOutline, decodeBrowserTrackedRect, paintBrowserFrameForConnection, updateBrowserSelectedRect } from '../src/client/managed-browser-stream.ts'
import { ManagedBrowserLayoutClient } from '../src/client/managed-browser-layout.ts'
import { encodeBrowserStreamFrameV2, encodeBrowserStreamJsonFrameV2, type BrowserStreamFrameV2 } from '../src/managed-browser-protocol.ts'

describe('managed Browser stream client', () => {
  afterEach(() => { vi.useRealTimers() })

  it('offers both frame carriers and frame ACK flow control in hello', () => {
    expect(browserStreamHello(true)).toEqual({
      type: 'hello',
      version: 2,
      frameEncodings: ['binary-v2', 'json-base64-v2'],
      flowControl: ['frame-ack-v2'],
      media: { webrtcVideo: true },
    })
    expect(browserStreamReady(JSON.stringify({ type: 'ready', version: 2, frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2', ownerId: 'owner-1', media: { preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 1000, frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: 15_000 }, fallback: { maxRawBytes: 1024 }, layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 120, hysteresisPx: 8 } }))).toEqual({
      type: 'ready',
      version: 2,
      frameEncoding: 'binary-v2',
      flowControl: 'frame-ack-v2',
      ownerId: 'owner-1',
      media: { preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 1000, frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: 15_000 },
      fallback: { maxRawBytes: 1024 },
      layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 120, hysteresisPx: 8 },
    })
    expect(browserStreamReady(JSON.stringify({ type: 'ready', version: 1 }))).toBeUndefined()
  })

  it('keeps laptop geometry authoritative while delayed and mismatched JPEG metadata alternates', () => {
    const layout = new ManagedBrowserLayoutClient({
      mode: 'laptop', settleMs: 120, hysteresisPx: 8,
      viewportLimits: { min: { width: 320, height: 240 }, max: { width: 1920, height: 1440 } },
    })
    layout.observeContainer({ width: 640, height: 600 }, 0)
    expect(layout.selectMode('laptop', 0)).toEqual({ proposalSequence: 1, mode: 'laptop', viewport: { width: 1280, height: 800 } })
    const commit = decodeBrowserLayoutCommit(JSON.stringify({ type: 'layout-commit', layout: { revision: 4, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 9 } }))
    expect(commit).toBeDefined()
    expect(layout.acceptCommit(commit!.layout)).toBe(true)

    expect(layout.acceptFrame({ revision: 3, mediaGeneration: 8, viewport: { width: 640, height: 600 }, encodedSize: { width: 960, height: 900 }, deviceSize: { width: 1280, height: 800 } })).toEqual({ accepted: false, switched: false })
    expect(layout.acceptFrame({ revision: 4, mediaGeneration: 9, viewport: { width: 1280, height: 800 }, encodedSize: { width: 1920, height: 1200 }, deviceSize: { width: 960, height: 900 } })).toEqual({ accepted: true, switched: true })
    expect(layout.surfaceSize()).toEqual({ width: 640, height: 400 })
    expect(layout.mapPoint({ x: 320, y: 200 }, { x: 0, y: 0, width: 640, height: 400 })).toEqual({ revision: 4, x: 640, y: 400 })
  })

  it('ACKs only after Canvas paint settles and also ACKs a decode failure', async () => {
    const events: string[] = []
    const identity = { sequence: 7, revision: 4, mediaGeneration: 9 }
    let finish: ((value: string) => void) | undefined
    const painting = paintBrowserFrameForConnection(
      identity,
      () => new Promise<string>((resolve) => { finish = resolve }),
      () => true,
      () => true,
      () => true,
      (value) => { events.push('paint:' + value) },
      (value) => { events.push('dispose:' + value) },
      (frame) => { events.push('ack:' + frame.sequence + ':' + frame.revision + ':' + frame.mediaGeneration) },
    )
    expect(events).toEqual([])
    finish?.('bitmap')
    await painting
    expect(events).toEqual(['paint:bitmap', 'dispose:bitmap', 'ack:7:4:9'])

    await expect(paintBrowserFrameForConnection(
      { ...identity, sequence: 8 },
      async () => { throw new Error('bad jpeg') },
      () => true,
      () => true,
      () => true,
      () => { throw new Error('must not paint') },
      () => { throw new Error('must not dispose') },
      (frame) => { events.push('ack:' + frame.sequence) },
    )).rejects.toThrow('bad jpeg')
    expect(events.at(-1)).toBe('ack:8')

    let accepted = false
    await expect(paintBrowserFrameForConnection(
      { ...identity, sequence: 9 },
      async () => 'bitmap',
      () => true,
      () => true,
      () => { accepted = true; return true },
      () => { throw new Error('paint failed') },
      () => {},
      (frame) => { events.push('ack:' + frame.sequence) },
    )).rejects.toThrow('paint failed')
    expect(accepted).toBe(false)
    expect(events.at(-1)).toBe('ack:9')
    const truncated = new ArrayBuffer(21)
    const view = new DataView(truncated)
    view.setUint8(0, 2); view.setUint32(1, 9); view.setUint32(13, 4); view.setUint32(17, 5)
    expect(browserBinaryFrameIdentity(truncated)).toEqual({ sequence: 9, revision: 4, mediaGeneration: 5 })
    expect(browserJsonFrameIdentity('{"type":"frame","version":2,"sequence":10,"revision":4,"mediaGeneration":5,"jpeg":"bad"}')).toEqual({ sequence: 10, revision: 4, mediaGeneration: 5 })
  })

  it('drops a delayed decode after reconnect without painting or ACKing the new socket', async () => {
    const oldAcks: number[] = []
    const newAcks: number[] = []
    const paints: string[] = []
    const disposals: string[] = []
    let activeConnection = 'old'
    let finishDecode: ((value: string) => void) | undefined
    const work = paintBrowserFrameForConnection(
      { sequence: 11, revision: 4, mediaGeneration: 9 },
      () => new Promise<string>((resolve) => { finishDecode = resolve }),
      () => activeConnection === 'old',
      () => true,
      () => true,
      (value) => { paints.push(value) },
      (value) => { disposals.push(value) },
      (identity) => {
        if (activeConnection === 'old') oldAcks.push(identity.sequence)
        else newAcks.push(identity.sequence)
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

  it('keeps an active stream through the hidden grace and cancels teardown after recovery', () => {
    vi.useFakeTimers()
    const transitions: boolean[] = []
    const visibility = new BrowserVisibilityGrace(true, (active) => { transitions.push(active) })
    visibility.setGraceMs(15_000)

    visibility.setVisible(false)
    vi.advanceTimersByTime(14_999)
    expect(transitions).toEqual([])
    visibility.setVisible(true)
    vi.advanceTimersByTime(15_000)
    expect(transitions).toEqual([])

    visibility.setVisible(false)
    vi.advanceTimersByTime(15_000)
    expect(transitions).toEqual([false])
    visibility.setVisible(true)
    expect(transitions).toEqual([false, true])
    visibility.dispose()
  })

  it('applies a changed Host grace to the original hidden deadline', () => {
    vi.useFakeTimers()
    const transitions: boolean[] = []
    const visibility = new BrowserVisibilityGrace(true, (active) => { transitions.push(active) })
    visibility.setVisible(false)
    vi.advanceTimersByTime(500)
    visibility.setGraceMs(1_000)
    vi.advanceTimersByTime(499)
    expect(transitions).toEqual([])
    vi.advanceTimersByTime(1)
    expect(transitions).toEqual([false])
    visibility.dispose()
  })
  it('decodes the host binary frame and derives same-origin ws URLs', () => {
    const encoded = encodeBrowserStreamFrameV2({
      version: 2,
      sequence: 3,
      sentAt: 42,
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1920, height: 1200 },
      jpeg: new Uint8Array([1, 2, 3]),
    })
    const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    expect(decodeBrowserFrame(buffer)).toEqual({
      version: 2,
      sequence: 3,
      sentAt: 42,
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1920, height: 1200 },
      jpeg: new Uint8Array([1, 2, 3]),
    })
    expect(browserWebSocketUrl('/cast', { protocol: 'http:', host: '127.0.0.1:3082' } as Location)).toBe('ws://127.0.0.1:3082/cast')
    expect(browserWebSocketUrl('/cast', { protocol: 'https:', host: 'lab.example' } as Location)).toBe('wss://lab.example/cast')
  })



  it('removes the Connecting overlay when a frame or ready projection arrives', () => {
    expect(browserStreamSignalsReady(new ArrayBuffer(29))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'ready', version: 2, frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2', ownerId: 'owner-1', media: { preferredRoute: 'webrtc-direct', stunOnly: true, negotiationTimeoutMs: 5000, retryCooldownMs: 1000, frameRate: 10, maxBitrate: 2_000_000, idleTimeoutMs: 300_000, hideGraceMs: 15_000 }, fallback: { maxRawBytes: 1024 }, layoutPolicy: { minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 120, hysteresisPx: 8 } }))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'ready' }))).toBe(false)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'state', projection: { status: 'ready' } }))).toBe(true)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'state', projection: { status: 'loading' } }))).toBe(false)
    expect(browserStreamSignalsReady('not json')).toBe(false)
    expect(browserStreamSignalsReady(JSON.stringify({ type: 'frame', version: 2, jpeg: 'abc' }))).toBe(true)
  })

  it('decodes JSON JPEG frames that DSH Mobile delivers as strings', () => {
    const frame: BrowserStreamFrameV2 = {
      version: 2,
      sequence: 9,
      sentAt: 12,
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 720, height: 860 },
      encodedSize: { width: 1080, height: 1290 },
      jpeg: new Uint8Array([0xff, 0xd8, 9, 8, 0xff, 0xd9]),
    }
    const encoded = encodeBrowserStreamJsonFrameV2(frame)
    expect(browserStreamTextMessage(encoded)).toBe(encoded)
    expect(decodeBrowserJpegJson(encoded)).toEqual({
      version: 2,
      sequence: 9,
      sentAt: 12,
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 720, height: 860 },
      encodedSize: { width: 1080, height: 1290 },
      jpeg: new Uint8Array([0xff, 0xd8, 9, 8, 0xff, 0xd9]),
    })
  })

  it('recovers JPEG frames that an APP WebView delivers as binary strings', () => {
    const encoded = encodeBrowserStreamFrameV2({
      version: 2,
      sequence: 3,
      sentAt: 42,
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 640, height: 480 },
      encodedSize: { width: 960, height: 720 },
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
