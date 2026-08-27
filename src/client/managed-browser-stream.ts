import { BROWSER_STREAM_V2_HEADER_BYTES, MANAGED_BROWSER_PROTOCOL_VERSION, decodeBrowserStreamFrameV2, decodeBrowserStreamJsonFrameV2, type BrowserLayoutCommitMessage, type BrowserReadyMessage, type BrowserStreamFrameV2 } from '../managed-browser-protocol.ts'

export function browserStreamShouldRun(pageVisible: boolean, intersecting: boolean): boolean {
  return pageVisible && intersecting
}

/** Touch taps must not focus the local hidden IME; it steals the remote click on Android. */
export function browserPointerShouldFocusIme(pointerType: string): boolean {
  return pointerType !== 'touch'
}

export type BrowserStreamSize = { width: number; height: number }

export type BrowserTouchGesture = {
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

export function browserTouchGestureMove(
  current: BrowserTouchGesture,
  x: number,
  y: number,
  threshold = 8,
): { gesture: BrowserTouchGesture; moved: boolean; deltaX: number; deltaY: number } {
  const moved = current.moved || Math.hypot(x - current.startX, y - current.startY) >= threshold
  return {
    gesture: { ...current, lastX: x, lastY: y, moved },
    moved,
    deltaX: current.lastX - x,
    deltaY: current.lastY - y,
  }
}

/** Letterbox content into the container. Never stretch a mismatched JPEG. */
export function browserStreamFitSurface(container: BrowserStreamSize, content: BrowserStreamSize): BrowserStreamSize {
  const scale = Math.min(
    container.width / Math.max(1, content.width),
    container.height / Math.max(1, content.height),
  )
  return {
    width: Math.max(1, Math.round(content.width * scale)),
    height: Math.max(1, Math.round(content.height * scale)),
  }
}

export const BROWSER_STREAM_HEADER_BYTES = BROWSER_STREAM_V2_HEADER_BYTES
export type DecodedBrowserFrame = BrowserStreamFrameV2
export type BrowserStreamFrameEncoding = 'binary-v2' | 'json-base64-v2'
export type BrowserFrameIdentity = Pick<BrowserStreamFrameV2, 'sequence' | 'revision' | 'mediaGeneration'>

/** Declare the encodings and flow control understood by the Canvas client. */
export function browserStreamHello(webrtcVideo = false): {
  type: 'hello'
  version: 2
  frameEncodings: BrowserStreamFrameEncoding[]
  flowControl: ['frame-ack-v2']
  media: { webrtcVideo: boolean }
} {
  return {
    type: 'hello',
    version: 2,
    frameEncodings: ['binary-v2', 'json-base64-v2'],
    flowControl: ['frame-ack-v2'],
    media: { webrtcVideo },
  }
}

export function browserStreamReady(value: string): BrowserReadyMessage | undefined {
  try {
    const message = JSON.parse(value) as BrowserReadyMessage
    if (message.type !== 'ready' || message.version !== 2 || message.flowControl !== 'frame-ack-v2') return undefined
    if (message.frameEncoding !== 'binary-v2' && message.frameEncoding !== 'json-base64-v2') return undefined
    if (!validSize(message.layoutPolicy?.minViewport) || !validSize(message.layoutPolicy?.maxViewport)
      || !finiteNonnegative(message.layoutPolicy?.settleMs) || !finiteNonnegative(message.layoutPolicy?.hysteresisPx)
      || !finiteNonnegative(message.fallback?.maxRawBytes)) return undefined
    return message
  } catch {
    return undefined
  }
}

export function decodeBrowserLayoutCommit(value: string): BrowserLayoutCommitMessage | undefined {
  try {
    const message = JSON.parse(value) as BrowserLayoutCommitMessage
    const layout = message.layout
    if (message.type !== 'layout-commit' || !positiveInteger(layout?.revision) || !positiveInteger(layout?.mediaGeneration)
      || !validSize(layout?.viewport) || !['fit', 'phone', 'tablet', 'laptop'].includes(layout?.mode)) return undefined
    return message
  } catch {
    return undefined
  }
}

/**
 * Decode and paint one frame only while its originating connection remains current.
 * @param identity Host frame and layout identity to acknowledge.
 * @param decode Deferred frame decoder.
 * @param isConnectionCurrent Whether the originating socket generation is still active.
 * @param isFrameCurrent Whether the frame still belongs to the committed layout.
 * @param acceptFrame Atomically publishes the layout after a successful paint.
 * @param paint Synchronous Canvas paint operation.
 * @param dispose Decoded-frame resource disposer.
 * @param acknowledge ACK sender bound to the originating socket.
 * @returns A promise that settles after decode, optional paint, disposal, and optional ACK.
 */
export async function paintBrowserFrameForConnection<T>(
  identity: BrowserFrameIdentity,
  decode: () => Promise<T>,
  isConnectionCurrent: () => boolean,
  isFrameCurrent: () => boolean,
  acceptFrame: () => boolean,
  paint: (decoded: T) => void,
  dispose: (decoded: T) => void,
  acknowledge: (identity: BrowserFrameIdentity) => void,
): Promise<void> {
  let disposeDecoded: (() => void) | undefined
  try {
    const decoded = await decode()
    disposeDecoded = () => { dispose(decoded) }
    if (!isConnectionCurrent() || !isFrameCurrent()) return
    paint(decoded)
    acceptFrame()
  } finally {
    disposeDecoded?.()
    if (isConnectionCurrent() && isFrameCurrent()) acknowledge(identity)
  }
}

export function decodeBrowserFrame(value: ArrayBuffer): DecodedBrowserFrame {
  return decodeBrowserStreamFrameV2(value)
}

export function browserBinaryFrameIdentity(value: ArrayBuffer): BrowserFrameIdentity | undefined {
  if (value.byteLength < 21 || new DataView(value).getUint8(0) !== MANAGED_BROWSER_PROTOCOL_VERSION) return undefined
  const view = new DataView(value)
  const identity = { sequence: view.getUint32(1), revision: view.getUint32(13), mediaGeneration: view.getUint32(17) }
  return positiveInteger(identity.sequence) && positiveInteger(identity.revision) && positiveInteger(identity.mediaGeneration) ? identity : undefined
}

function looksLikeJsonText(value: string): boolean {
  const start = value.trimStart()[0]
  return start === '{' || start === '['
}

function latin1Buffer(value: string): ArrayBuffer {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff
  return bytes.buffer
}

/** APP WebViews may deliver JPEG frames as ArrayBuffer, typed arrays, Blob, or binary strings. */
export function browserStreamFrameBuffer(data: unknown): ArrayBuffer | undefined {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const view = data
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  }
  if (typeof data !== 'string' || looksLikeJsonText(data) || data.length < BROWSER_STREAM_HEADER_BYTES) return undefined
  const buffer = latin1Buffer(data)
  return new Uint8Array(buffer)[0] === MANAGED_BROWSER_PROTOCOL_VERSION ? buffer : undefined
}

export function browserStreamTextMessage(data: unknown): string | undefined {
  return typeof data === 'string' && looksLikeJsonText(data) ? data : undefined
}




export type BrowserOutlineNode = {
  ref: string
  role: string
  name: string
  selector: string
  rect: { x: number; y: number; w: number; h: number }
}

export type BrowserOutline = {
  documentId: string
  nodes: BrowserOutlineNode[]
}

export function decodeBrowserOutline(value: string): BrowserOutline | undefined {
  try {
    const message = JSON.parse(value) as { type?: unknown; documentId?: unknown; nodes?: unknown }
    if (message.type !== 'outline' || typeof message.documentId !== 'string' || !Array.isArray(message.nodes)) return undefined
    const nodes: BrowserOutlineNode[] = []
    for (const value of message.nodes) {
      if (!browserOutlineNode(value)) return undefined
      nodes.push(value)
    }
    return { documentId: message.documentId, nodes }
  } catch {
    return undefined
  }
}



export type BrowserAnnotationRect = { x: number; y: number; w: number; h: number }





export type BrowserTrackedRect = {
  documentId: string
  selector: string
  rect: BrowserAnnotationRect | null
}

export function decodeBrowserTrackedRect(value: string): BrowserTrackedRect | undefined {
  try {
    const message = JSON.parse(value) as { type?: unknown; documentId?: unknown; selector?: unknown; rect?: unknown }
    if (message.type !== 'tracked-rect' || typeof message.documentId !== 'string' || typeof message.selector !== 'string') return undefined
    if (message.rect === null) return { documentId: message.documentId, selector: message.selector, rect: null }
    if (!browserAnnotationRect(message.rect)) return undefined
    return { documentId: message.documentId, selector: message.selector, rect: message.rect }
  } catch {
    return undefined
  }
}

export function updateBrowserSelectedRect(current: BrowserAnnotationRect | null, update: { type: 'wheel' } | { type: 'tracked'; rect: BrowserAnnotationRect | null }): BrowserAnnotationRect | null {
  return update.type === 'tracked' ? update.rect : current
}

export function browserAnnotationHighlightRects(selected: BrowserAnnotationRect | null, hovered: BrowserAnnotationRect | null): { selected: BrowserAnnotationRect | null; hovered: BrowserAnnotationRect | null } {
  return { selected, hovered: sameBrowserAnnotationRect(selected, hovered) ? null : hovered }
}

function sameBrowserAnnotationRect(left: BrowserAnnotationRect | null, right: BrowserAnnotationRect | null): boolean {
  return left !== null && right !== null && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h
}

function browserAnnotationRect(value: unknown): value is BrowserAnnotationRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  return [rect.x, rect.y, rect.w, rect.h].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
}

export function browserSelectedRectForOutline(selector: string, nodes: readonly BrowserOutlineNode[]): BrowserAnnotationRect | null {
  return nodes.find((node) => node.selector === selector)?.rect ?? null
}

export function browserAnnotationNodeAt(nodes: readonly BrowserOutlineNode[], point: { x: number; y: number }): BrowserOutlineNode | undefined {
  return nodes
    .filter((node) => node.rect.w > 0 && node.rect.h > 0
      && point.x >= node.rect.x && point.x <= node.rect.x + node.rect.w
      && point.y >= node.rect.y && point.y <= node.rect.y + node.rect.h)
    .sort((left, right) => left.rect.w * left.rect.h - right.rect.w * right.rect.h)[0]
}

function browserOutlineNode(value: unknown): value is BrowserOutlineNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as { ref?: unknown; role?: unknown; name?: unknown; selector?: unknown; rect?: unknown }
  if (typeof node.ref !== 'string' || typeof node.role !== 'string' || typeof node.name !== 'string' || typeof node.selector !== 'string') return false
  if (typeof node.rect !== 'object' || node.rect === null) return false
  const rect = node.rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  return [rect.x, rect.y, rect.w, rect.h].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
}

export function decodeBrowserJpegJson(value: string): DecodedBrowserFrame | undefined {
  return decodeBrowserStreamJsonFrameV2(value)
}

export function browserJsonFrameIdentity(value: string): BrowserFrameIdentity | undefined {
  try {
    const message = JSON.parse(value) as { type?: unknown; version?: unknown; sequence?: unknown; revision?: unknown; mediaGeneration?: unknown }
    return message.type === 'frame' && message.version === 2 && positiveInteger(message.sequence)
      && positiveInteger(message.revision) && positiveInteger(message.mediaGeneration)
      ? { sequence: message.sequence, revision: message.revision, mediaGeneration: message.mediaGeneration }
      : undefined
  } catch {
    return undefined
  }
}

export function browserStreamSignalsReady(value: unknown): boolean {
  if (value instanceof ArrayBuffer) return true
  if (typeof value !== 'string') return false
  try {
    const message = JSON.parse(value) as { type?: unknown; projection?: unknown }
    if (message.type === 'ready') return browserStreamReady(value) !== undefined
    if (message.type === 'frame') return message.version === 2
    if (message.type !== 'state' || typeof message.projection !== 'object' || message.projection === null) return false
    return (message.projection as { status?: unknown }).status === 'ready'
  } catch {
    return false
  }
}

function validSize(value: unknown): value is BrowserStreamSize {
  if (typeof value !== 'object' || value === null) return false
  const size = value as { width?: unknown; height?: unknown }
  return typeof size.width === 'number' && Number.isFinite(size.width) && size.width > 0
    && typeof size.height === 'number' && Number.isFinite(size.height) && size.height > 0
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function browserWebSocketUrl(path: string, locationLike: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return (locationLike.protocol === 'https:' ? 'wss://' : 'ws://') + locationLike.host + path
}

export type StreamInput = { type: string; [key: string]: unknown }

export function createBrowserInputCoalescer(
  send: (input: StreamInput) => void,
  schedule: (flush: () => void) => number = (flush) => requestAnimationFrame(flush),
  cancelSchedule: (id: number) => void = (id) => cancelAnimationFrame(id),
): { push(input: StreamInput): void; flush(): void; cancel(): void } {
  let move: StreamInput | undefined
  let wheel: StreamInput | undefined
  let scheduled: number | undefined
  const flush = (): void => {
    scheduled = undefined
    if (move !== undefined) send(move)
    if (wheel !== undefined) send(wheel)
    move = undefined
    wheel = undefined
  }
  const arm = (): void => { scheduled ??= schedule(flush) }
  return {
    push(input) {
      if (input.type === 'move') {
        move = input
        arm()
        return
      }
      if (input.type === 'wheel') {
        wheel = wheel === undefined ? input : {
          ...input,
          deltaX: Number(wheel.deltaX ?? 0) + Number(input.deltaX ?? 0),
          deltaY: Number(wheel.deltaY ?? 0) + Number(input.deltaY ?? 0),
        }
        arm()
        return
      }
      flush()
      send(input)
    },
    flush,
    cancel() {
      if (scheduled !== undefined) cancelSchedule(scheduled)
      scheduled = undefined
      move = undefined
      wheel = undefined
    },
  }
}
