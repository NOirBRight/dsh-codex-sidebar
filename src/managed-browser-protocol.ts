/** Versioned wire messages shared by the managed Browser Host and client. */

export const MANAGED_BROWSER_PROTOCOL_VERSION = 2
export const BROWSER_STREAM_V2_HEADER_BYTES = 29

export type BrowserLayoutMode = 'fit' | 'phone' | 'tablet' | 'laptop'
export type BrowserSize = { width: number; height: number }

export type BrowserLayout = {
  revision: number
  mode: BrowserLayoutMode
  viewport: BrowserSize
  mediaGeneration: number
}

export type BrowserInput =
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; selector?: string }
  | { type: 'tap'; x: number; y: number }
  | { type: 'down' | 'up' | 'move'; x: number; y: number; pressed?: boolean }
  | { type: 'keyDown' | 'keyUp'; key: string; code: string; modifiers?: number }
  | { type: 'text'; text: string }

export type BrowserClientMessage =
  | { type: 'hello'; version: 2; frameEncodings: Array<'binary-v2' | 'json-base64-v2'>; flowControl: ['frame-ack-v2'] }
  | { type: 'layout-propose'; proposalSequence: number; mode: BrowserLayoutMode; viewport: BrowserSize }
  | { type: 'input'; revision: number; input: BrowserInput }
  | { type: 'frame-ack'; sequence: number; revision: number; mediaGeneration: number }
  | { type: 'outline' }

export type BrowserReadyMessage = {
  type: 'ready'
  version: 2
  frameEncoding: 'binary-v2' | 'json-base64-v2'
  flowControl: 'frame-ack-v2'
  fallback: { maxRawBytes: number }
  layoutPolicy: { minViewport: BrowserSize; maxViewport: BrowserSize; settleMs: number; hysteresisPx: number }
}

export type BrowserLayoutCommitMessage = { type: 'layout-commit'; layout: BrowserLayout }
export type BrowserMediaRouteMessage = {
  type: 'media-route'
  route: 'jpeg-fallback' | 'webrtc-direct' | 'unavailable'
  status: 'active' | 'degraded' | 'reconnecting'
  reason?: string
}

export type BrowserStreamFrameV2 = {
  version: 2
  sequence: number
  sentAt: number
  revision: number
  mediaGeneration: number
  viewport: BrowserSize
  encodedSize: BrowserSize
  jpeg: Uint8Array
}

/** Decode one untrusted control message from the Browser WebSocket. */
export function decodeBrowserClientMessage(raw: string): BrowserClientMessage | undefined {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!record(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'hello') {
    if (value.version !== MANAGED_BROWSER_PROTOCOL_VERSION || !Array.isArray(value.frameEncodings) || !Array.isArray(value.flowControl)) return undefined
    const frameEncodings = value.frameEncodings.filter((item): item is 'binary-v2' | 'json-base64-v2' => item === 'binary-v2' || item === 'json-base64-v2')
    if (frameEncodings.length !== value.frameEncodings.length || value.flowControl.length !== 1 || value.flowControl[0] !== 'frame-ack-v2') return undefined
    return { type: 'hello', version: 2, frameEncodings, flowControl: ['frame-ack-v2'] }
  }
  if (value.type === 'layout-propose') {
    if (!positiveSafeInteger(value.proposalSequence) || !layoutMode(value.mode) || !size(value.viewport)) return undefined
    return { type: 'layout-propose', proposalSequence: value.proposalSequence, mode: value.mode, viewport: value.viewport }
  }
  if (value.type === 'input') {
    if (!positiveSafeInteger(value.revision) || !browserInput(value.input)) return undefined
    return { type: 'input', revision: value.revision, input: value.input }
  }
  if (value.type === 'frame-ack') {
    if (!positiveSafeInteger(value.sequence) || !positiveSafeInteger(value.revision) || !positiveSafeInteger(value.mediaGeneration)) return undefined
    return { type: 'frame-ack', sequence: value.sequence, revision: value.revision, mediaGeneration: value.mediaGeneration }
  }
  return value.type === 'outline' ? { type: 'outline' } : undefined
}

/** Encode one binary JPEG frame with layout and media identity. */
export function encodeBrowserStreamFrameV2(frame: BrowserStreamFrameV2): Uint8Array {
  const header = new Uint8Array(BROWSER_STREAM_V2_HEADER_BYTES)
  const view = new DataView(header.buffer)
  view.setUint8(0, frame.version)
  view.setUint32(1, frame.sequence)
  view.setFloat64(5, frame.sentAt)
  view.setUint32(13, frame.revision)
  view.setUint32(17, frame.mediaGeneration)
  view.setUint16(21, frame.viewport.width)
  view.setUint16(23, frame.viewport.height)
  view.setUint16(25, frame.encodedSize.width)
  view.setUint16(27, frame.encodedSize.height)
  const encoded = new Uint8Array(header.length + frame.jpeg.length)
  encoded.set(header)
  encoded.set(frame.jpeg, header.length)
  return encoded
}

/** Decode one binary v2 JPEG frame. */
export function decodeBrowserStreamFrameV2(value: ArrayBuffer | Uint8Array): BrowserStreamFrameV2 {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  if (bytes.byteLength < BROWSER_STREAM_V2_HEADER_BYTES) throw new Error('Browser stream v2 frame is shorter than its header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint8(0)
  if (version !== MANAGED_BROWSER_PROTOCOL_VERSION) throw new Error('Unsupported Browser stream frame version')
  return {
    version: 2,
    sequence: view.getUint32(1),
    sentAt: view.getFloat64(5),
    revision: view.getUint32(13),
    mediaGeneration: view.getUint32(17),
    viewport: { width: view.getUint16(21), height: view.getUint16(23) },
    encodedSize: { width: view.getUint16(25), height: view.getUint16(27) },
    jpeg: new Uint8Array(bytes.buffer, bytes.byteOffset + BROWSER_STREAM_V2_HEADER_BYTES, bytes.byteLength - BROWSER_STREAM_V2_HEADER_BYTES),
  }
}

/** Encode a tunneled JSON v2 JPEG frame. */
export function encodeBrowserStreamJsonFrameV2(frame: BrowserStreamFrameV2): string {
  return JSON.stringify({
    type: 'frame',
    version: frame.version,
    sequence: frame.sequence,
    sentAt: frame.sentAt,
    revision: frame.revision,
    mediaGeneration: frame.mediaGeneration,
    viewport: frame.viewport,
    encodedSize: frame.encodedSize,
    jpeg: Buffer.from(frame.jpeg).toString('base64'),
  })
}

/** Decode one tunneled JSON v2 JPEG frame. */
export function decodeBrowserStreamJsonFrameV2(raw: string): BrowserStreamFrameV2 | undefined {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!record(value)
    || value.type !== 'frame'
    || value.version !== MANAGED_BROWSER_PROTOCOL_VERSION
    || !positiveSafeInteger(value.sequence)
    || !finite(value.sentAt)
    || !positiveSafeInteger(value.revision)
    || !positiveSafeInteger(value.mediaGeneration)
    || !size(value.viewport)
    || !size(value.encodedSize)
    || typeof value.jpeg !== 'string') return undefined
  let jpeg: Uint8Array
  try {
    const binary = atob(value.jpeg)
    jpeg = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return undefined
  }
  return {
    version: 2,
    sequence: value.sequence,
    sentAt: value.sentAt,
    revision: value.revision,
    mediaGeneration: value.mediaGeneration,
    viewport: value.viewport,
    encodedSize: value.encodedSize,
    jpeg,
  }
}

function browserInput(value: unknown): value is BrowserInput {
  if (!record(value) || typeof value.type !== 'string') return false
  if (value.type === 'text') return typeof value.text === 'string'
  if (value.type === 'keyDown' || value.type === 'keyUp') {
    return typeof value.key === 'string' && typeof value.code === 'string'
      && (value.modifiers === undefined || nonNegativeSafeInteger(value.modifiers))
  }
  if (!finite(value.x) || !finite(value.y)) return false
  if (value.type === 'wheel') {
    return finite(value.deltaX) && finite(value.deltaY)
      && (value.selector === undefined || typeof value.selector === 'string')
  }
  if (value.type === 'move') return value.pressed === undefined || typeof value.pressed === 'boolean'
  return value.type === 'tap' || value.type === 'down' || value.type === 'up'
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function size(value: unknown): value is BrowserSize {
  return record(value) && finite(value.width) && finite(value.height) && value.width > 0 && value.height > 0
}

function layoutMode(value: unknown): value is BrowserLayoutMode {
  return value === 'fit' || value === 'phone' || value === 'tablet' || value === 'laptop'
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
