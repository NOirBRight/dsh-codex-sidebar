import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import {
  browserStreamCaptureScale,
  browserStreamRequestAllowed,
  browserStreamTransportProfile,
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

describe('managed browser stream protocol', () => {
  it('sends ready before a stalled screencast startup can hold the Mobile UI on Connecting', async () => {
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => {
      if (method === 'Page.startScreencast') return await new Promise(() => {})
      return {}
    }
    const runtime = {
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
      const first = await Promise.race([
        new Promise<string>((resolve, reject) => {
          client.once('message', (data) => { resolve(Buffer.from(data as Buffer).toString('utf8')) })
          client.once('error', reject)
        }),
        new Promise<string>((_resolve, reject) => { setTimeout(() => { reject(new Error('ready timeout')) }, 100) }),
      ])
      expect(JSON.parse(first)).toMatchObject({ type: 'ready' })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  })

  it('accepts Mobile tunnel binary JSON and sends a fresh frame after tap', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64')
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: jpeg }
      return {}
    }
    const runtime = {
      target: () => ({ page: { viewportSize: () => ({ width: 390, height: 844 }) }, cdp }),
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
    const frames: Array<{ type?: string; sequence?: number }> = []
    client.on('message', (data) => {
      const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: string; sequence?: number }
      if (message.type === 'frame') frames.push(message)
    })
    try {
      await vi.waitFor(() => { expect(frames.at(-1)?.sequence).toBe(1) })
      // The Mobile pairing loopback bridge forwards client messages as binary Buffer frames.
      client.send(Buffer.from(JSON.stringify({ type: 'input', input: { type: 'tap', x: 120, y: 240 } })))
      await vi.waitFor(() => { expect(frames.at(-1)?.sequence).toBe(2) })
    } finally {
      client.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
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

  it('caps screencast below a full 20fps capture loop', () => {
    expect(MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS).toBeGreaterThanOrEqual(100)
    expect(MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME).toBeGreaterThanOrEqual(2)
  })

  it('uses a low-bandwidth profile for Origin-less Mobile tunnel sockets', () => {
    expect(browserStreamTransportProfile(undefined)).toMatchObject({ quality: 65, maxScale: 1, frameIntervalMs: 250, everyNthFrame: 4 })
    expect(browserStreamTransportProfile('http://127.0.0.1:3080')).toMatchObject({ quality: 80, maxScale: 1.5, frameIntervalMs: 100, everyNthFrame: 2 })
    expect(browserStreamCaptureScale(720, 860, 1)).toBe(1)
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
