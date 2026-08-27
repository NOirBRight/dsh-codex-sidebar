import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserFallbackActivityBudget,
  browserStreamCaptureDelay,
  browserStreamCaptureScale,
  browserStreamRequestAllowed,
  browserStreamTransportProfile,
  browserStreamVisualViewportOrigin,
  decodeBrowserStreamFrame,
  dispatchBrowserInput,
  encodeBrowserStreamFrame,
  encodeBrowserStreamJsonFrame,
  ManagedBrowserStream,
  MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME,
  MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS,
  MANAGED_BROWSER_STREAM_PATH,
  MANAGED_BROWSER_STREAM_VERSION,
} from '../src/managed-browser-stream.ts'
import { decodeBrowserStreamFrameV2 } from '../src/managed-browser-protocol.ts'

function v2RuntimePorts() {
  return {
    acquire: () => () => {},
    layout: () => ({ revision: 1, mode: 'laptop' as const, viewport: { width: 720, height: 860 }, mediaGeneration: 1 }),
    layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
  }
}

describe('managed browser stream protocol', () => {
  it('terminates an unresponsive socket and forgets hung work by the shutdown deadline', async () => {
    let captureStarted: (() => void) | undefined
    let finishCapture: ((value: unknown) => void) | undefined
    const capturing = new Promise<void>((resolve) => { captureStarted = resolve })
    const captureResult = new Promise<unknown>((resolve) => { finishCapture = resolve })
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => {
      if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 0, pageY: 0 } }
      if (method === 'Page.captureScreenshot') {
        captureStarted?.()
        return await captureResult
      }
      return {}
    }
    let leaseReleases = 0
    const runtime = {
      ...v2RuntimePorts(),
      acquire: () => () => { leaseReleases += 1 },
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 's:t',
      touch: () => {},
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, shutdownTimeoutMs: 25 })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 's', tabId: 't' }).path)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => {
        client.send(JSON.stringify({
          type: 'hello', version: 2, frameEncodings: ['json-base64-v2'],
          flowControl: ['frame-ack-v2'], media: { webrtcVideo: false },
        }))
        resolve()
      })
      client.once('error', reject)
    })
    await capturing
    ;(client as unknown as { _socket: { pause(): void } })._socket.pause()

    const startedAt = Date.now()
    const disposing = stream.dispose()
    expect(stream.dispose()).toBe(disposing)
    await disposing
    expect(Date.now() - startedAt).toBeLessThan(250)
    expect(stream.resources()).toEqual({ sockets: 0, timers: 0, captures: 0, unackedFrames: 0, peers: 0 })
    expect(leaseReleases).toBe(1)

    finishCapture?.({ data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(stream.resources()).toEqual({ sockets: 0, timers: 0, captures: 0, unackedFrames: 0, peers: 0 })

    ;(client as unknown as { _socket: { resume(): void } })._socket.resume()
    client.terminate()
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  })

  it('requires hello before ready and advertises the Mobile frame protocol before stalled CDP startup', async () => {
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => {
      if (method === 'Page.startScreencast') return await new Promise(() => {})
      return {}
    }
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 's:t',
      touch: () => {},
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const ticket = stream.issue({ sessionId: 's', tabId: 't' })
    const client = new WebSocket('ws://127.0.0.1:' + address.port + ticket.path)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 25)
        client.once('message', () => {
          clearTimeout(timer)
          reject(new Error('host sent before client hello'))
        })
        client.once('error', reject)
      })
      client.send(JSON.stringify({
        type: 'hello',
        version: MANAGED_BROWSER_STREAM_VERSION,
        frameEncodings: ['binary-v2', 'json-base64-v2'],
        flowControl: ['frame-ack-v2'],
        media: { webrtcVideo: false },
      }))
      const first = await Promise.race([
        new Promise<string>((resolve, reject) => {
          client.once('message', (data) => { resolve(Buffer.from(data as Buffer).toString('utf8')) })
          client.once('error', reject)
        }),
        new Promise<string>((_resolve, reject) => { setTimeout(() => { reject(new Error('ready timeout')) }, 100) }),
      ])
      expect(JSON.parse(first)).toMatchObject({
        type: 'ready',
        version: MANAGED_BROWSER_STREAM_VERSION,
        frameEncoding: 'json-base64-v2',
        flowControl: 'frame-ack-v2',
        media: { hideGraceMs: 15_000 },
      })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('fails closed when the client does not send hello within the handshake deadline', async () => {
    const cdp = new EventEmitter() as EventEmitter & { send(): Promise<unknown> }
    cdp.send = async () => ({})
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 's:t',
      touch: () => {},
      projection: () => undefined,
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, handshakeTimeoutMs: 20 })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 's', tabId: 't' }).path)
    try {
      const closed = await Promise.race([
        new Promise<{ code: number; reason: string }>((resolve, reject) => {
          client.once('close', (code, reason) => { resolve({ code, reason: reason.toString() }) })
          client.once('error', reject)
        }),
        new Promise<{ code: number; reason: string }>((_resolve, reject) => {
          setTimeout(() => { reject(new Error('host did not enforce hello timeout')) }, 200)
        }),
      ])
      expect(closed).toEqual({ code: 1008, reason: 'Browser stream hello timeout' })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('accepts Mobile binary input and captures the visual viewport after scroll', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64')
    const clips: Array<{ x?: number; y?: number }> = []
    let scrollY = 0
    let now = 1_000
    const cdp = new EventEmitter() as EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
    cdp.send = async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseWheel') scrollY += Number(params.deltaY ?? 0)
      if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 0, pageY: scrollY } }
      if (method === 'Page.captureScreenshot') {
        clips.push((params?.clip ?? {}) as { x?: number; y?: number })
        return { data: jpeg }
      }
      return {}
    }
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 390, height: 844 }) }, cdp }),
      keyOf: () => 's:t',
      touch: () => {},
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, now: () => now })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const ticket = stream.issue({ sessionId: 's', tabId: 't' })
    const client = new WebSocket('ws://127.0.0.1:' + address.port + ticket.path)
    const frames: Array<{ type?: string; sequence?: number }> = []
    client.on('message', (data) => {
      const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: string; sequence?: number }
      if (message.type === 'frame') frames.push(message)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
          resolve()
        })
        client.once('error', reject)
      })
      await vi.waitFor(() => { expect(frames.at(-1)?.sequence).toBe(1) })
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 1, revision: 1, mediaGeneration: 1 }))
      // The Mobile pairing loopback bridge forwards client messages as binary Buffer frames.
      now += 250
      client.send(Buffer.from(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 120, y: 240 } })))
      await vi.waitFor(() => { expect(frames.at(-1)?.sequence).toBe(2) })
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 2, revision: 1, mediaGeneration: 1 }))
      now += 300
      client.send(Buffer.from(JSON.stringify({ type: 'input', revision: 1, input: { type: 'wheel', x: 120, y: 240, deltaX: 0, deltaY: 360 } })))
      await vi.waitFor(() => { expect(frames.at(-1)?.sequence).toBe(3) })
      expect(clips.at(-1)).toMatchObject({ x: 0, y: 360 })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('uses binary v2 frames for Desktop Origin connections', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 3, 4, 0xff, 0xd9]).toString('base64')
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => method === 'Page.captureScreenshot' ? { data: jpeg } : {}
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 'desktop:tab',
      touch: () => {},
      projection: () => undefined,
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const origin = 'http://127.0.0.1:' + address.port
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 'desktop', tabId: 'tab' }).path, { headers: { origin } })
    try {
      const messages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = []
      client.on('message', (data, isBinary) => { messages.push({ data, isBinary }) })
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
          resolve()
        })
        client.once('error', reject)
      })
      await vi.waitFor(() => { expect(messages.some((message) => message.isBinary)).toBe(true) })
      const ready = messages.find((message) => !message.isBinary)
      expect(JSON.parse(Buffer.from(ready?.data as Buffer).toString('utf8'))).toMatchObject({ frameEncoding: 'binary-v2', flowControl: 'frame-ack-v2' })
      const binary = messages.find((message) => message.isBinary)
      expect(decodeBrowserStreamFrameV2(binary?.data as Buffer).jpeg).toEqual(new Uint8Array([0xff, 0xd8, 3, 4, 0xff, 0xd9]))
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('holds one capture and one unacked frame while retaining the latest dirty request', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 5, 6, 0xff, 0xd9]).toString('base64')
    const captures: Array<() => void> = []
    const clips: Array<{ width?: number; height?: number }> = []
    const sourceAcks: number[] = []
    const cdp = new EventEmitter() as EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
    cdp.send = async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Page.screencastFrameAck') sourceAcks.push(Number(params?.sessionId))
      if (method === 'Page.captureScreenshot') {
        clips.push((params?.clip ?? {}) as { width?: number; height?: number })
        return await new Promise((resolve) => { captures.push(() => { resolve({ data: jpeg }) }) })
      }
      return {}
    }
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 'flow:tab',
      touch: () => {},
      projection: () => undefined,
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 'flow', tabId: 'tab' }).path)
    const frames: number[] = []
    client.on('message', (data, isBinary) => {
      if (isBinary) return
      const value = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: string; sequence?: number }
      if (value.type === 'frame' && typeof value.sequence === 'number') frames.push(value.sequence)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
          resolve()
        })
        client.once('error', reject)
      })
      await vi.waitFor(() => { expect(captures).toHaveLength(1) })
      cdp.emit('Page.screencastFrame', { data: jpeg, sessionId: 11, metadata: { deviceWidth: 640, deviceHeight: 480 } })
      cdp.emit('Page.screencastFrame', { data: jpeg, sessionId: 12, metadata: { deviceWidth: 800, deviceHeight: 600 } })
      expect(sourceAcks).toEqual([11, 12])
      expect(captures).toHaveLength(1)
      captures.shift()?.()
      await vi.waitFor(() => { expect(frames).toEqual([1]) })
      await new Promise((resolve) => { setTimeout(resolve, 120) })
      expect(captures).toHaveLength(0)
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 0, revision: 1, mediaGeneration: 1 }))
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 2, revision: 1, mediaGeneration: 1 }))
      await new Promise((resolve) => { setTimeout(resolve, 25) })
      expect(captures).toHaveLength(0)
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 1, revision: 1, mediaGeneration: 1 }))
      await vi.waitFor(() => { expect(captures).toHaveLength(1) })
      expect(clips.at(-1)).toMatchObject({ width: 720, height: 860 })
      captures.shift()?.()
      await vi.waitFor(() => { expect(frames).toEqual([1, 2]) })
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 1, revision: 1, mediaGeneration: 1 }))
      await new Promise((resolve) => { setTimeout(resolve, 25) })
      expect(captures).toHaveLength(0)
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('sends the final throttled dirty frame from a timer without another source event', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 7, 8, 0xff, 0xd9]).toString('base64')
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => method === 'Page.captureScreenshot' ? { data: jpeg } : {}
    const runtime = {
      ...v2RuntimePorts(),
      target: () => ({ page: { viewportSize: () => ({ width: 720, height: 860 }) }, cdp }),
      keyOf: () => 'timer:tab',
      touch: () => {},
      projection: () => undefined,
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 'timer', tabId: 'tab' }).path)
    const frames: number[] = []
    client.on('message', (data, isBinary) => {
      if (isBinary) return
      const value = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: string; sequence?: number }
      if (value.type === 'frame' && typeof value.sequence === 'number') frames.push(value.sequence)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
          resolve()
        })
        client.once('error', reject)
      })
      await vi.waitFor(() => { expect(frames).toEqual([1]) })
      client.send(JSON.stringify({ type: 'frame-ack', sequence: 1, revision: 1, mediaGeneration: 1 }))
      cdp.emit('Page.screencastFrame', { data: jpeg, sessionId: 9, metadata: { deviceWidth: 640, deviceHeight: 480 } })
      await vi.waitFor(() => { expect(frames).toEqual([1, 2]) }, { timeout: 500 })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('reads finite visual viewport coordinates for screenshot clips', () => {
    expect(browserStreamVisualViewportOrigin({ visualViewport: { pageX: 12, pageY: 360 } })).toEqual({ x: 12, y: 360 })
    expect(browserStreamVisualViewportOrigin({ visualViewport: { pageX: Number.NaN, pageY: 'bad' } })).toEqual({ x: 0, y: 0 })
    expect(browserStreamVisualViewportOrigin(undefined)).toEqual({ x: 0, y: 0 })
  })

  it('encodes JPEG frames as JSON text so DSH Mobile can tunnel them', () => {
    const encoded = encodeBrowserStreamJsonFrame({
      version: MANAGED_BROWSER_STREAM_VERSION,
      sequence: 7,
      sentAt: 99,
      width: 390,
      height: 844,
      jpeg: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    })
    expect(encoded.startsWith('{')).toBe(true)
    const parsed = JSON.parse(encoded) as { type: string; jpeg: string; width: number; height: number }
    expect(parsed.type).toBe('frame')
    expect(parsed.width).toBe(390)
    expect(parsed.height).toBe(844)
    expect(Buffer.from(parsed.jpeg, 'base64')).toEqual(Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]))
  })

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

  it('keeps Desktop capture at no more than 10 FPS', () => {
    expect(MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS).toBeGreaterThanOrEqual(100)
    expect(MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME).toBeGreaterThanOrEqual(2)
  })

  it('uses a low-bandwidth profile for Origin-less Mobile tunnel sockets', () => {
    expect(browserStreamTransportProfile('mobile')).toMatchObject({ quality: 65, maxScale: 1, frameIntervalMs: 250, everyNthFrame: 4, interactionBurstFrames: 4 })
    expect(browserStreamTransportProfile('desktop')).toMatchObject({ quality: 80, maxScale: 1.5, frameIntervalMs: 100, everyNthFrame: 2, interactionBurstFrames: 20 })
    expect(browserStreamTransportProfile('mobile', {
      mobileJpegQuality: 52,
      mobileJpegFrameIntervalMs: 400,
      mobileJpegMaxScale: 0.75,
      mobileScreencastEveryNthFrame: 6,
      mobileJpegInteractionBurstFrames: 3,
      mobileJpegMaxRawBytes: 72 * 1024,
    })).toEqual({
      frameEncoding: 'json-base64-v2', quality: 52, frameIntervalMs: 400,
      maxScale: 0.75, everyNthFrame: 6, interactionBurstFrames: 3, maxRawBytes: 72 * 1024,
    })
    expect(browserStreamTransportProfile('desktop', {
      desktopJpegQuality: 74,
      desktopJpegFrameIntervalMs: 125,
      desktopJpegMaxScale: 1.25,
      desktopScreencastEveryNthFrame: 3,
      desktopJpegInteractionBurstFrames: 12,
      desktopJpegMaxRawBytes: 320 * 1024,
    })).toEqual({
      frameEncoding: 'binary-v2', quality: 74, frameIntervalMs: 125,
      maxScale: 1.25, everyNthFrame: 3, interactionBurstFrames: 12, maxRawBytes: 320 * 1024,
    })
    expect(browserStreamCaptureScale(720, 860, 1)).toBe(1)
  })

  it('rejects invalid configured JPEG transport profiles', () => {
    expect(() => browserStreamTransportProfile('desktop', { desktopJpegQuality: 101 })).toThrow('desktopJpegQuality')
    expect(() => browserStreamTransportProfile('mobile', { mobileJpegFrameIntervalMs: 0 })).toThrow('mobileJpegFrameIntervalMs')
    expect(() => browserStreamTransportProfile('mobile', { mobileJpegMaxScale: Number.NaN })).toThrow('mobileJpegMaxScale')
    expect(() => browserStreamTransportProfile('mobile', { mobileScreencastEveryNthFrame: 0 })).toThrow('mobileScreencastEveryNthFrame')
    expect(() => browserStreamTransportProfile('mobile', { mobileJpegInteractionBurstFrames: -1 })).toThrow('mobileJpegInteractionBurstFrames')
    expect(() => browserStreamTransportProfile('desktop', { desktopJpegInteractionBurstFrames: 601 })).toThrow('desktopJpegInteractionBurstFrames')
  })

  it('keeps twenty forced demands behind the configured hard frame interval with fake time', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(10_000)
      let capturedAt: number | undefined
      let unacked = false
      let pending = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const captures: number[] = []
      const pump = (): void => {
        if (unacked || !pending || timer !== undefined) return
        const delay = browserStreamCaptureDelay(capturedAt, Date.now(), 100)
        timer = setTimeout(() => {
          timer = undefined
          pending = false
          unacked = true
          capturedAt = Date.now()
          captures.push(capturedAt)
        }, delay)
      }
      const demand = (): void => { pending = true; pump() }
      const acknowledge = (): void => { unacked = false; pump() }

      demand()
      vi.advanceTimersByTime(0)
      for (let index = 0; index < 20; index += 1) {
        acknowledge()
        demand()
        vi.advanceTimersByTime(99)
        expect(captures).toHaveLength(index + 1)
        vi.advanceTimersByTime(1)
      }
      expect(captures).toHaveLength(21)
      expect(captures.slice(1).every((value, index) => value - captures[index]! >= 100)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds passive animation frames until a new interaction replenishes the budget', () => {
    const budget = new BrowserFallbackActivityBudget(3)
    budget.activate()
    expect(Array.from({ length: 20 }, () => budget.takePassive())).toEqual([
      true, true, true,
      ...Array.from({ length: 17 }, () => false),
    ])
    budget.activate()
    expect(budget.takePassive()).toBe(true)
    expect(budget.remaining()).toBe(2)
    expect(budget.takePassive(true)).toBe(true)
    expect(budget.remaining()).toBe(2)
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

  it('dispatches one mobile tap as an atomic mouse press and release', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
    const cdp = {
      async send(method: string, params?: Record<string, unknown>) { calls.push({ method, params }); return {} },
    }
    await dispatchBrowserInput(cdp as never, { type: 'tap', x: 120, y: 240 })
    expect(calls).toEqual([
      { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 120, y: 240, button: 'left', buttons: 1, clickCount: 1 } },
      { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 120, y: 240, button: 'left', buttons: 0, clickCount: 1 } },
    ])
  })

  it('authorizes APP WebViews that omit Origin as long as Host is present', () => {
    expect(browserStreamRequestAllowed(undefined, '127.0.0.1:3080')).toBe(true)
    expect(browserStreamRequestAllowed('', '127.0.0.1:3080')).toBe(true)
    expect(browserStreamRequestAllowed('http://127.0.0.1:3080', '127.0.0.1:3080')).toBe(true)
    expect(browserStreamRequestAllowed('http://evil.example', '127.0.0.1:3080')).toBe(false)
    expect(browserStreamRequestAllowed('null', '127.0.0.1:3080')).toBe(false)
    expect(browserStreamRequestAllowed('http://127.0.0.1:3080', undefined)).toBe(false)
  })
})
