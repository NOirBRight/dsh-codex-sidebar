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
}

type ScreencastPayload = {
  data?: unknown
  sessionId?: unknown
  metadata?: { deviceWidth?: unknown; deviceHeight?: unknown }
}

type BrowserInput =
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'down' | 'up' | 'move'; x: number; y: number; pressed?: boolean }
  | { type: 'keyDown' | 'keyUp'; key: string; code: string; modifiers?: number }
  | { type: 'text'; text: string }

export class ManagedBrowserStream {
  #runtime: ManagedBrowserRuntime
  #now: () => number
  #ticketTtlMs: number
  #tickets = new Map<string, StreamTicket>()
  #server = new WebSocketServer({ noServer: true })
  #sockets = new Set<WebSocket>()
  #tabSockets = new Map<string, WebSocket>()

  constructor(opts: ManagedBrowserStreamOptions) {
    this.#runtime = opts.runtime
    this.#now = opts.now ?? Date.now
    this.#ticketTtlMs = opts.ticketTtlMs ?? TICKET_TTL_MS
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
      void this.#attach(ws, tab, target.cdp)
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
    const host = req.headers.host
    const origin = req.headers.origin
    if (host === undefined || origin === undefined || !sameOriginHost(origin, host)) return undefined
    let ticket: string | null = null
    try { ticket = new URL(req.url ?? '', 'http://' + host).searchParams.get('ticket') } catch { return undefined }
    if (ticket === null || ticket.length === 0) return undefined
    return this.consume(ticket)
  }

  async #attach(socket: WebSocket, tab: ManagedTabKey, cdp: ManagedCdpSession): Promise<void> {
    const tabKey = this.#runtime.keyOf(tab)
    const previous = this.#tabSockets.get(tabKey)
    if (previous !== undefined && previous.readyState === WebSocket.OPEN) previous.close(4001, 'Replaced by a newer stream')
    this.#tabSockets.set(tabKey, socket)
    this.#sockets.add(socket)
    let sequence = 0
    let lastFrameAt = 0
    let lastProjection = ''
    const sendProjection = (): void => {
      if (socket.readyState !== WebSocket.OPEN) return
      const projection = this.#runtime.projection(tab)
      if (projection === undefined) return
      const signature = projection.documentId + ':' + projection.status + ':' + projection.url + ':' + projection.title
      if (signature === lastProjection) return
      lastProjection = signature
      socket.send(JSON.stringify({ type: 'state', projection }))
    }
    const onFrame = (value: unknown): void => {
      const payload = value as ScreencastPayload
      sendProjection()
      if (typeof payload.sessionId === 'number') void cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined)
      const now = this.#now()
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES || typeof payload.data !== 'string' || now - lastFrameAt < 33) return
      lastFrameAt = now
      const jpeg = Buffer.from(payload.data, 'base64')
      sequence += 1
      socket.send(encodeBrowserStreamFrame({
        version: MANAGED_BROWSER_STREAM_VERSION,
        sequence,
        sentAt: now,
        width: finiteDimension(payload.metadata?.deviceWidth, 720),
        height: finiteDimension(payload.metadata?.deviceHeight, 860),
        jpeg,
      }), { binary: true })
    }
    let detached = false
    const detach = async (): Promise<void> => {
      if (detached) return
      detached = true
      cdp.off('Page.screencastFrame', onFrame)
      this.#sockets.delete(socket)
      if (this.#tabSockets.get(tabKey) !== socket) return
      this.#tabSockets.delete(tabKey)
      await cdp.send('Page.stopScreencast').catch(() => undefined)
    }
    cdp.on('Page.screencastFrame', onFrame)
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      void this.#onMessage(tab, cdp, data.toString()).catch(() => undefined)
    })
    socket.once('close', () => { void detach() })
    socket.once('error', () => { void detach() })
    try {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 62,
        maxWidth: 1920,
        maxHeight: 1440,
        everyNthFrame: 1,
      })
      socket.send(JSON.stringify({ type: 'ready', version: MANAGED_BROWSER_STREAM_VERSION }))
      sendProjection()
    } catch (error) {
      socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : 'Cannot start screencast')
    }
  }

  async #onMessage(tab: ManagedTabKey, cdp: ManagedCdpSession, raw: string): Promise<void> {
    const message = JSON.parse(raw) as { type?: unknown; input?: unknown; width?: unknown; height?: unknown }
    if (message.type === 'resize' && typeof message.width === 'number' && typeof message.height === 'number') {
      await this.#runtime.resize(tab, message.width, message.height)
      return
    }
    if (message.type !== 'input' || !validInput(message.input)) return
    await dispatchInput(cdp, message.input)
  }

  #pruneTickets(): void {
    const now = this.#now()
    for (const [ticket, record] of this.#tickets) if (record.expiresAt < now) this.#tickets.delete(ticket)
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

async function dispatchInput(cdp: ManagedCdpSession, input: BrowserInput): Promise<void> {
  if (input.type === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY })
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
    const wheel = value as { deltaX?: unknown; deltaY?: unknown }
    return typeof wheel.deltaX === 'number' && typeof wheel.deltaY === 'number'
  }
  return type === 'down' || type === 'up' || type === 'move'
}

function sameOriginHost(origin: string, host: string): boolean {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host
  } catch {
    return false
  }
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
