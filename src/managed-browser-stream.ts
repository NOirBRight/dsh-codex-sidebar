/** Authenticated same-origin screencast and input transport for managed Browser Tabs. */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { ManagedBrowserRuntime, ManagedCdpSession, ManagedTabKey } from './managed-browser-runtime.ts'

export const MANAGED_BROWSER_STREAM_PATH = '/__dcs/browser-stream'
export const MANAGED_BROWSER_STREAM_VERSION = 1

const TICKET_TTL_MS = 30_000
const MAX_BUFFERED_BYTES = 512 * 1024
export const MANAGED_BROWSER_STREAM_HANDSHAKE_TIMEOUT_MS = 5_000
export const MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS = 100
export const MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME = 2
export const MANAGED_BROWSER_MOBILE_FRAME_INTERVAL_MS = 250
export const MANAGED_BROWSER_MOBILE_EVERY_NTH_FRAME = 4
const HIGH_DENSITY_SCALE = 1.5

export const MANAGED_BROWSER_STREAM_QUALITY = 80
export const MANAGED_BROWSER_MOBILE_STREAM_QUALITY = 65

export type BrowserStreamTransportProfile = {
  frameEncoding: 'binary-v1' | 'json-base64-v1'
  quality: number
  maxScale: number
  frameIntervalMs: number
  everyNthFrame: number
}

export function browserStreamTransportProfile(origin: string | undefined): BrowserStreamTransportProfile {
  return origin === undefined || origin.length === 0
    ? { frameEncoding: 'json-base64-v1', quality: MANAGED_BROWSER_MOBILE_STREAM_QUALITY, maxScale: 1, frameIntervalMs: MANAGED_BROWSER_MOBILE_FRAME_INTERVAL_MS, everyNthFrame: MANAGED_BROWSER_MOBILE_EVERY_NTH_FRAME }
    : { frameEncoding: 'binary-v1', quality: MANAGED_BROWSER_STREAM_QUALITY, maxScale: HIGH_DENSITY_SCALE, frameIntervalMs: MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS, everyNthFrame: MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME }
}
export const MANAGED_BROWSER_STREAM_MAX_WIDTH = 2560
export const MANAGED_BROWSER_STREAM_MAX_HEIGHT = 2048

type StreamTicket = {
  tab: ManagedTabKey
  expiresAt: number
}

export type BrowserStreamTicket = {
  ticket: string
  path: string
  expiresAt: number
}

export type BrowserStreamFrame = {
  version: number
  sequence: number
  sentAt: number
  width: number
  height: number
  jpeg: Uint8Array
}

export type ManagedBrowserStreamOptions = {
  runtime: ManagedBrowserRuntime
  now?: () => number
  ticketTtlMs?: number
  handshakeTimeoutMs?: number
}

type ScreencastPayload = {
  data?: unknown
  sessionId?: unknown
  metadata?: { deviceWidth?: unknown; deviceHeight?: unknown }
}

type CaptureRequest = {
  width: number
  height: number
  fallback?: string
}

export type BrowserInput =
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; selector?: string }
  | { type: 'tap'; x: number; y: number }
  | { type: 'down' | 'up' | 'move'; x: number; y: number; pressed?: boolean }
  | { type: 'keyDown' | 'keyUp'; key: string; code: string; modifiers?: number }
  | { type: 'text'; text: string }

export class ManagedBrowserStream {
  #runtime: ManagedBrowserRuntime
  #now: () => number
  #ticketTtlMs: number
  #handshakeTimeoutMs: number
  #tickets = new Map<string, StreamTicket>()
  #server = new WebSocketServer({ noServer: true })
  #sockets = new Set<WebSocket>()
  #tabSockets = new Map<string, WebSocket>()

  constructor(opts: ManagedBrowserStreamOptions) {
    this.#runtime = opts.runtime
    this.#now = opts.now ?? Date.now
    this.#ticketTtlMs = opts.ticketTtlMs ?? TICKET_TTL_MS
    this.#handshakeTimeoutMs = opts.handshakeTimeoutMs ?? MANAGED_BROWSER_STREAM_HANDSHAKE_TIMEOUT_MS
  }

  issue(tab: ManagedTabKey): BrowserStreamTicket {
    this.#pruneTickets()
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = this.#now() + this.#ticketTtlMs
    this.#tickets.set(ticket, { tab, expiresAt })
    return { ticket, expiresAt, path: MANAGED_BROWSER_STREAM_PATH + '?ticket=' + encodeURIComponent(ticket) }
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const tab = this.#authorize(req)
    if (tab === undefined) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    const target = this.#runtime.target(tab)
    if (target === undefined) {
      rejectUpgrade(socket, 409, 'Browser page is not ready')
      return
    }
    this.#server.handleUpgrade(req, socket, head, (ws) => {
      this.#server.emit('connection', ws, req)
      void this.#attach(ws, tab, target, browserStreamTransportProfile(typeof req.headers.origin === 'string' ? req.headers.origin : undefined))
    })
  }

  async dispose(): Promise<void> {
    for (const socket of this.#sockets) socket.close(1001, 'Plugin disposed')
    this.#sockets.clear()
    this.#tabSockets.clear()
    this.#tickets.clear()
    await new Promise<void>((resolve) => { this.#server.close(() => resolve()) })
  }

  consume(ticket: string): ManagedTabKey | undefined {
    const record = this.#tickets.get(ticket)
    this.#tickets.delete(ticket)
    if (record === undefined || record.expiresAt < this.#now()) return undefined
    return record.tab
  }

  #authorize(req: IncomingMessage): ManagedTabKey | undefined {
    const host = typeof req.headers.host === 'string' ? req.headers.host : undefined
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    if (!browserStreamRequestAllowed(origin, host)) return undefined
    let ticket: string | null = null
    try { ticket = new URL(req.url ?? '', 'http://' + host).searchParams.get('ticket') } catch { return undefined }
    if (ticket === null || ticket.length === 0) return undefined
    return this.consume(ticket)
  }

  async #attach(
    socket: WebSocket,
    tab: ManagedTabKey,
    target: { page: { viewportSize(): { width: number; height: number } | null }; cdp: ManagedCdpSession },
    profile: BrowserStreamTransportProfile,
  ): Promise<void> {
    const cdp = target.cdp
    const tabKey = this.#runtime.keyOf(tab)
    const previous = this.#tabSockets.get(tabKey)
    if (previous !== undefined && previous.readyState === WebSocket.OPEN) previous.close(4001, 'Replaced by a newer stream')
    this.#tabSockets.set(tabKey, socket)
    this.#sockets.add(socket)
    this.#runtime.touch(tab)
    let sequence = 0
    let lastFrameAt = 0
    let lastProjection = ''
    let captureInFlight = false
    let unackedSequence: number | undefined
    let dirty: { request: CaptureRequest; force: boolean } | undefined
    let frameTimer: ReturnType<typeof setTimeout> | undefined
    let sourceAttached = false
    let handshaken = false
    let detached = false
    const sendProjection = (): void => {
      if (socket.readyState !== WebSocket.OPEN) return
      const projection = this.#runtime.projection(tab)
      if (projection === undefined) return
      const signature = projection.documentId + ':' + projection.status + ':' + projection.url + ':' + projection.title
      if (signature === lastProjection) return
      lastProjection = signature
      socket.send(JSON.stringify({ type: 'state', projection }))
    }
    const sendFrame = (jpeg: Uint8Array, width: number, height: number): boolean => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return false
      sequence += 1
      const frame = {
        version: MANAGED_BROWSER_STREAM_VERSION,
        sequence,
        sentAt: this.#now(),
        width,
        height,
        jpeg,
      }
      socket.send(profile.frameEncoding === 'binary-v1'
        ? encodeBrowserStreamFrame(frame)
        : encodeBrowserStreamJsonFrame(frame))
      unackedSequence = sequence
      return true
    }
    const captureFrame = async (request: CaptureRequest): Promise<Uint8Array | undefined> => {
      try {
        const metrics = await cdp.send('Page.getLayoutMetrics').catch(() => undefined)
        const origin = browserStreamVisualViewportOrigin(metrics)
        const result = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: profile.quality,
          fromSurface: true,
          captureBeyondViewport: false,
          clip: {
            x: origin.x,
            y: origin.y,
            width: request.width,
            height: request.height,
            scale: browserStreamCaptureScale(request.width, request.height, profile.maxScale),
          },
        })
        const data = screenshotData(result)
        if (data === undefined) throw new Error('Browser screenshot returned no data')
        return Buffer.from(data, 'base64')
      } catch {
        return request.fallback === undefined ? undefined : Buffer.from(request.fallback, 'base64')
      }
    }
    const armFrameTimer = (delay: number, pump: () => void): void => {
      if (frameTimer !== undefined) return
      frameTimer = setTimeout(() => {
        frameTimer = undefined
        pump()
      }, Math.max(1, delay))
      frameTimer.unref()
    }
    const pump = (): void => {
      if (detached || !handshaken || socket.readyState !== WebSocket.OPEN) return
      if (captureInFlight || unackedSequence !== undefined || dirty === undefined) return
      const delay = dirty.force ? 0 : profile.frameIntervalMs - (this.#now() - lastFrameAt)
      if (delay > 0) {
        armFrameTimer(delay, pump)
        return
      }
      if (frameTimer !== undefined) {
        clearTimeout(frameTimer)
        frameTimer = undefined
      }
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        armFrameTimer(profile.frameIntervalMs, pump)
        return
      }
      const next = dirty
      dirty = undefined
      lastFrameAt = this.#now()
      captureInFlight = true
      void captureFrame(next.request).then((jpeg) => {
        if (jpeg === undefined || detached) return
        if (!sendFrame(jpeg, next.request.width, next.request.height)) {
          dirty = { request: next.request, force: true }
        }
      }).finally(() => {
        captureInFlight = false
        pump()
      })
    }
    const requestFrame = (request: CaptureRequest, force = false): void => {
      if (detached || socket.readyState !== WebSocket.OPEN) return
      dirty = { request, force: force || dirty?.force === true }
      pump()
    }
    const onFrame = (value: unknown): void => {
      const payload = value as ScreencastPayload
      sendProjection()
      if (typeof payload.sessionId === 'number') void cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined)
      if (typeof payload.data !== 'string') return
      const width = finiteDimension(payload.metadata?.deviceWidth, 720)
      const height = finiteDimension(payload.metadata?.deviceHeight, 860)
      requestFrame({ width, height, fallback: payload.data })
    }
    const detach = async (): Promise<void> => {
      if (detached) return
      detached = true
      clearTimeout(helloTimer)
      if (frameTimer !== undefined) clearTimeout(frameTimer)
      frameTimer = undefined
      if (sourceAttached) cdp.off('Page.screencastFrame', onFrame)
      this.#sockets.delete(socket)
      dirty = undefined
      if (this.#tabSockets.get(tabKey) !== socket) return
      this.#tabSockets.delete(tabKey)
      if (sourceAttached) await cdp.send('Page.stopScreencast').catch(() => undefined)
    }
    const start = async (): Promise<void> => {
      sourceAttached = true
      cdp.on('Page.screencastFrame', onFrame)
      socket.send(JSON.stringify({
        type: 'ready',
        version: MANAGED_BROWSER_STREAM_VERSION,
        frameEncoding: profile.frameEncoding,
        flowControl: 'frame-ack-v1',
      }))
      sendProjection()
      try {
        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: profile.quality,
          maxWidth: MANAGED_BROWSER_STREAM_MAX_WIDTH,
          maxHeight: MANAGED_BROWSER_STREAM_MAX_HEIGHT,
          everyNthFrame: profile.everyNthFrame,
        })
        if (detached) return
        // A settled page may not emit a screencast frame until it repaints.
        const viewport = target.page.viewportSize() ?? { width: 720, height: 860 }
        requestFrame({ width: viewport.width, height: viewport.height }, true)
      } catch (error) {
        if (!detached) socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : 'Cannot start screencast')
      }
    }
    const helloTimer = setTimeout(() => {
      if (!handshaken) socket.close(1008, 'Browser stream hello timeout')
    }, this.#handshakeTimeoutMs)
    helloTimer.unref()
    // DSH Mobile's loopback bridge forwards client text messages as binary Buffers.
    socket.on('message', (data) => {
      const raw = data.toString()
      if (!handshaken) {
        if (!browserStreamHelloAccepted(raw, profile.frameEncoding)) {
          socket.close(1002, 'Invalid Browser stream hello')
          return
        }
        handshaken = true
        clearTimeout(helloTimer)
        void start()
        return
      }
      const ack = browserStreamFrameAck(raw)
      if (ack !== undefined) {
        if (ack === unackedSequence) {
          unackedSequence = undefined
          pump()
        }
        return
      }
      void this.#onMessage(socket, tab, cdp, raw, requestFrame).catch(() => undefined)
    })
    socket.once('close', () => { void detach() })
    socket.once('error', () => { void detach() })
  }

  async #onMessage(socket: WebSocket, tab: ManagedTabKey, cdp: ManagedCdpSession, raw: string, requestFrame: (request: CaptureRequest, force?: boolean) => void): Promise<void> {
    const message = JSON.parse(raw) as { type?: unknown; input?: unknown; width?: unknown; height?: unknown }
    if (message.type === 'outline') {
      const outline = await this.#runtime.outline(tab)
      if ('nodes' in outline && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'outline',
          documentId: outline.documentId,
          nodes: outline.nodes.filter((node) => node.rect !== undefined),
        }))
      }
      return
    }
    if (message.type === 'resize' && typeof message.width === 'number' && typeof message.height === 'number') {
      await this.#runtime.resize(tab, message.width, message.height)
      requestFrame({ width: message.width, height: message.height }, true)
      return
    }
    if (message.type !== 'input' || !validInput(message.input)) return
    await dispatchBrowserInput(cdp, message.input)
    if (message.input.type === 'wheel') await waitForBrowserPaint(cdp)
    const viewport = this.#runtime.target(tab)?.page.viewportSize() ?? { width: 720, height: 860 }
    requestFrame(
      { width: viewport.width, height: viewport.height },
      message.input.type === 'tap' || message.input.type === 'up' || message.input.type === 'keyUp' || message.input.type === 'text',
    )
    if (message.input.type === 'wheel' && message.input.selector !== undefined) {
      const tracked = await this.#runtime.trackRect(tab, message.input.selector)
      if ('rect' in tracked && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'tracked-rect', ...tracked }))
      }
    }
  }

  #pruneTickets(): void {
    const now = this.#now()
    for (const [ticket, record] of this.#tickets) if (record.expiresAt < now) this.#tickets.delete(ticket)
  }
}

export function browserStreamVisualViewportOrigin(value: unknown): { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return { x: 0, y: 0 }
  const viewport = (value as { visualViewport?: unknown }).visualViewport
  if (typeof viewport !== 'object' || viewport === null) return { x: 0, y: 0 }
  const pageX = (viewport as { pageX?: unknown }).pageX
  const pageY = (viewport as { pageY?: unknown }).pageY
  return {
    x: typeof pageX === 'number' && Number.isFinite(pageX) ? pageX : 0,
    y: typeof pageY === 'number' && Number.isFinite(pageY) ? pageY : 0,
  }
}

export function encodeBrowserStreamFrame(frame: BrowserStreamFrame): Uint8Array {
  const header = Buffer.allocUnsafe(17)
  header.writeUInt8(frame.version, 0)
  header.writeUInt32BE(frame.sequence, 1)
  header.writeDoubleBE(frame.sentAt, 5)
  header.writeUInt16BE(frame.width, 13)
  header.writeUInt16BE(frame.height, 15)
  return new Uint8Array(Buffer.concat([header, Buffer.from(frame.jpeg)]))
}

export function encodeBrowserStreamJsonFrame(frame: BrowserStreamFrame): string {
  return JSON.stringify({
    type: 'frame',
    version: frame.version,
    sequence: frame.sequence,
    sentAt: frame.sentAt,
    width: frame.width,
    height: frame.height,
    jpeg: Buffer.from(frame.jpeg).toString('base64'),
  })
}

export function decodeBrowserStreamFrame(value: ArrayBuffer | Uint8Array): BrowserStreamFrame {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  if (bytes.byteLength < 17) throw new Error('Browser stream frame is shorter than its header')
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    version: view.readUInt8(0),
    sequence: view.readUInt32BE(1),
    sentAt: view.readDoubleBE(5),
    width: view.readUInt16BE(13),
    height: view.readUInt16BE(15),
    jpeg: new Uint8Array(bytes.buffer, bytes.byteOffset + 17, bytes.byteLength - 17),
  }
}

async function waitForBrowserPaint(cdp: ManagedCdpSession): Promise<void> {
  await cdp.send('Runtime.evaluate', {
    expression: 'new Promise(resolve => requestAnimationFrame(() => resolve()))',
    awaitPromise: true,
    returnByValue: true,
  }).catch(() => undefined)
}

export async function dispatchBrowserInput(cdp: ManagedCdpSession, input: BrowserInput): Promise<void> {
  if (input.type === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY })
    return
  }
  if (input.type === 'tap') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: input.x, y: input.y, button: 'left', buttons: 1, clickCount: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: input.x, y: input.y, button: 'left', buttons: 0, clickCount: 1,
    })
    return
  }
  if (input.type === 'down' || input.type === 'up' || input.type === 'move') {
    const pressed = input.type === 'down' || (input.type === 'move' && input.pressed === true)
    await cdp.send('Input.dispatchMouseEvent', {
      type: input.type === 'down' ? 'mousePressed' : input.type === 'up' ? 'mouseReleased' : 'mouseMoved',
      x: input.x,
      y: input.y,
      button: pressed ? 'left' : input.type === 'up' ? 'left' : 'none',
      buttons: pressed ? 1 : 0,
      ...input.type === 'move' ? {} : { clickCount: 1 },
    })
    return
  }
  if (input.type === 'text') {
    await cdp.send('Input.insertText', { text: input.text })
    return
  }
  if (input.type === 'keyDown' || input.type === 'keyUp') {
    await cdp.send('Input.dispatchKeyEvent', {
      type: input.type === 'keyDown' ? 'keyDown' : 'keyUp',
      key: input.key,
      code: input.code,
      modifiers: input.modifiers ?? 0,
    })
  }
}

function validInput(value: unknown): value is BrowserInput {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const type = (value as { type?: unknown }).type
  if (type === 'text') return typeof (value as { text?: unknown }).text === 'string'
  if (type === 'keyDown' || type === 'keyUp') {
    const input = value as { key?: unknown; code?: unknown }
    return typeof input.key === 'string' && typeof input.code === 'string'
  }
  const input = value as { x?: unknown; y?: unknown }
  if (typeof input.x !== 'number' || typeof input.y !== 'number') return false
  if (type === 'wheel') {
    const wheel = value as { deltaX?: unknown; deltaY?: unknown; selector?: unknown }
    return typeof wheel.deltaX === 'number' && typeof wheel.deltaY === 'number'
      && (wheel.selector === undefined || typeof wheel.selector === 'string')
  }
  return type === 'tap' || type === 'down' || type === 'up' || type === 'move'
}

function browserStreamHelloAccepted(raw: string, frameEncoding: BrowserStreamTransportProfile['frameEncoding']): boolean {
  try {
    const message = JSON.parse(raw) as { type?: unknown; version?: unknown; frameEncodings?: unknown; flowControl?: unknown }
    return message.type === 'hello'
      && message.version === MANAGED_BROWSER_STREAM_VERSION
      && Array.isArray(message.frameEncodings)
      && message.frameEncodings.includes(frameEncoding)
      && Array.isArray(message.flowControl)
      && message.flowControl.includes('frame-ack-v1')
  } catch {
    return false
  }
}

function browserStreamFrameAck(raw: string): number | undefined {
  try {
    const message = JSON.parse(raw) as { type?: unknown; sequence?: unknown }
    return message.type === 'frame-ack' && typeof message.sequence === 'number' && Number.isSafeInteger(message.sequence) && message.sequence > 0
      ? message.sequence
      : undefined
  } catch {
    return undefined
  }
}

export function browserStreamRequestAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (host === undefined || host.length === 0) return false
  if (origin === undefined || origin.length === 0) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host
  } catch {
    return false
  }
}

export function browserStreamCaptureScale(width: number, height: number, maxScale = HIGH_DENSITY_SCALE): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  return Math.max(0.1, Math.min(
    maxScale,
    MANAGED_BROWSER_STREAM_MAX_WIDTH / width,
    MANAGED_BROWSER_STREAM_MAX_HEIGHT / height,
  ))
}

function screenshotData(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = (value as { data?: unknown }).data
  return typeof data === 'string' && data.length > 0 ? data : undefined
}

function finiteDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(65_535, Math.max(1, Math.round(value)))
    : fallback
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end('HTTP/1.1 ' + status + ' ' + message + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  socket.destroy()
}
