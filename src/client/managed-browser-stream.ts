import { BROWSER_STREAM_V2_HEADER_BYTES, MANAGED_BROWSER_MAX_RTC_CANDIDATES, MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS, MANAGED_BROWSER_PROTOCOL_VERSION, decodeBrowserHostMessage, decodeBrowserStreamFrameV2, decodeBrowserStreamJsonFrameV2, type BrowserClientMessage, type BrowserLayoutCommitMessage, type BrowserMediaIdentity, type BrowserMediaRouteMessage, type BrowserReadyMessage, type BrowserRtcCandidate, type BrowserStreamFrameV2 } from '../managed-browser-protocol.ts'

export function browserStreamShouldRun(pageVisible: boolean, intersecting: boolean, surfaceActive = true): boolean {
  return pageVisible && intersecting && surfaceActive
}

/** Buffers bounded Host ICE candidates only for the current owner and media generation. */
export class BrowserRtcCandidateBuffer {
  #identity: BrowserMediaIdentity | undefined
  #candidates: Array<BrowserRtcCandidate | null> = []

  /** Select the authoritative signaling identity and discard candidates from an older generation. */
  setIdentity(identity: BrowserMediaIdentity): void {
    if (this.#identity !== undefined && sameMediaIdentity(this.#identity, identity)) return
    this.#identity = { ...identity }
    this.#candidates = []
  }

  /** Add one early candidate when it belongs to the selected identity and capacity remains. */
  add(identity: BrowserMediaIdentity, candidate: BrowserRtcCandidate | null): boolean {
    if (this.#identity === undefined || !sameMediaIdentity(this.#identity, identity)
      || this.#candidates.length >= MANAGED_BROWSER_MAX_RTC_CANDIDATES) return false
    this.#candidates.push(candidate)
    return true
  }

  /** Remove all queued candidates for an exact offer in their original arrival order. */
  drain(identity: BrowserMediaIdentity): Array<BrowserRtcCandidate | null> {
    if (this.#identity === undefined || !sameMediaIdentity(this.#identity, identity)) return []
    return this.#candidates.splice(0)
  }

  /** Discard the selected identity and every queued candidate. */
  clear(): void {
    this.#identity = undefined
    this.#candidates = []
  }
}

function sameMediaIdentity(left: BrowserMediaIdentity, right: BrowserMediaIdentity): boolean {
  return left.ownerId === right.ownerId
    && left.revision === right.revision
    && left.mediaGeneration === right.mediaGeneration
}

/** Delays disconnecting an already-active Browser stream while its surface is hidden. */
export class BrowserVisibilityGrace {
  #active: boolean
  #surfaceVisible: boolean
  #graceMs = MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS
  #hiddenAt: number | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #disposed = false
  #onActiveChange: (active: boolean) => void
  #now: () => number

  /**
   * @param initiallyVisible Whether the stream is active when visibility tracking starts.
   * @param onActiveChange Publishes connection eligibility after grace transitions.
   * @param now Monotonic-enough clock used to preserve the original hidden deadline.
   */
  constructor(
    initiallyVisible: boolean,
    onActiveChange: (active: boolean) => void,
    now: () => number = () => performance.now(),
  ) {
    this.#active = initiallyVisible
    this.#surfaceVisible = initiallyVisible
    this.#onActiveChange = onActiveChange
    this.#now = now
  }

  /** Update the Host-authoritative hidden-surface grace duration. */
  setGraceMs(graceMs: number): void {
    if (!Number.isSafeInteger(graceMs) || graceMs < 0) throw new Error('managed Browser mediaHideGraceMs must be a non-negative integer')
    this.#graceMs = graceMs
    if (!this.#surfaceVisible && this.#active) this.#arm()
  }

  /** Report whether both the document and Browser surface are visible. */
  setVisible(visible: boolean): void {
    if (this.#disposed) return
    this.#surfaceVisible = visible
    if (visible) {
      this.#hiddenAt = undefined
      this.#clearTimer()
      if (!this.#active) {
        this.#active = true
        this.#onActiveChange(true)
      }
      return
    }
    if (!this.#active) return
    this.#hiddenAt ??= this.#now()
    this.#arm()
  }

  /** Stop pending visibility work without changing connection state. */
  dispose(): void {
    this.#disposed = true
    this.#clearTimer()
  }

  #arm(): void {
    this.#clearTimer()
    const remaining = Math.max(0, (this.#hiddenAt ?? this.#now()) + this.#graceMs - this.#now())
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      if (this.#disposed || this.#surfaceVisible || !this.#active) return
      this.#active = false
      this.#onActiveChange(false)
    }, remaining)
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }
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
export type BrowserMediaRetryState = { identity: BrowserMediaIdentity; nextRetryAt: number }
export type BrowserMediaPresentationRoute = 'direct-video' | 'low-bandwidth-fallback' | 'reconnecting' | 'unavailable'
export type BrowserMediaFailureReason = 'negotiation-timeout' | 'negotiation-error' | 'peer-failed' | 'host-fallback' | 'presentation-failed'

/** Assemble an exact client decline after direct video cannot present its first frame. */
export function browserMediaDeclineMessage(identity: BrowserMediaIdentity): Extract<BrowserClientMessage, { type: 'media-decline' }> {
  return { type: 'media-decline', ...identity, reason: 'presentation-failed' }
}

/** Decline only a local failure that still belongs to the current Host media identity. */
export function browserMediaDeclineForFailure(
  failed: BrowserMediaIdentity,
  current: BrowserMediaIdentity | undefined,
  reason: BrowserMediaFailureReason | undefined,
): Extract<BrowserClientMessage, { type: 'media-decline' }> | undefined {
  if (current === undefined || reason === undefined || reason === 'host-fallback' || !sameMediaIdentity(failed, current)) return undefined
  return browserMediaDeclineMessage(failed)
}

/** Report immediate surface visibility for the exact committed media identity. */
export function browserSurfaceVisibilityMessage(
  ready: Pick<BrowserReadyMessage, 'ownerId'> | null,
  layout: Pick<BrowserMediaIdentity, 'revision' | 'mediaGeneration'> | undefined,
  visible: boolean,
): Extract<BrowserClientMessage, { type: 'surface-visibility' }> | undefined {
  if (ready === null || layout === undefined) return undefined
  return { type: 'surface-visibility', ownerId: ready.ownerId, ...layout, visible }
}

/** Project one Host route update without claiming direct video before a decoded frame is presented. */
export function browserMediaRouteFromHost(
  message: BrowserMediaRouteMessage,
  current: BrowserMediaPresentationRoute,
): BrowserMediaPresentationRoute {
  if (message.route === 'unavailable') return 'unavailable'
  if (message.status === 'reconnecting') return 'reconnecting'
  if (message.route === 'jpeg-fallback') return 'low-bandwidth-fallback'
  return current === 'direct-video' ? current : 'reconnecting'
}

/** Project the receiver's presentation-aware route into the user-visible state. */
export function browserMediaRouteFromReceiver(
  route: 'connecting' | 'webrtc-direct' | 'jpeg-fallback',
): BrowserMediaPresentationRoute {
  if (route === 'connecting') return 'reconnecting'
  return route === 'webrtc-direct' ? 'direct-video' : 'low-bandwidth-fallback'
}

/** Rate-limit a receiver-less retry while allowing a new layout/media identity immediately. */
export function browserMediaRetryRequest(
  state: BrowserMediaRetryState | undefined,
  identity: BrowserMediaIdentity,
  trigger: 'explicit' | 'network-change' | 'tab-reactivate',
  cooldownMs: number,
  now: number,
): { state: BrowserMediaRetryState; message?: Extract<BrowserClientMessage, { type: 'media-retry' }> } {
  const same = state !== undefined && state.identity.ownerId === identity.ownerId
    && state.identity.revision === identity.revision && state.identity.mediaGeneration === identity.mediaGeneration
  if (same && now < state.nextRetryAt) return { state }
  const next = { identity: { ...identity }, nextRetryAt: now + cooldownMs }
  return { state: next, message: { type: 'media-retry', ...identity, trigger } }
}

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
  const message = decodeBrowserHostMessage(value)
  return message?.type === 'ready' ? message : undefined
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

export function decodeBrowserMediaRoute(value: string): BrowserMediaRouteMessage | undefined {
  try {
    const message = JSON.parse(value) as BrowserMediaRouteMessage
    if (message.type !== 'media-route' || !['jpeg-fallback', 'webrtc-direct', 'unavailable'].includes(message.route)
      || !['active', 'degraded', 'reconnecting'].includes(message.status)
      || (message.reason !== undefined && typeof message.reason !== 'string')) return undefined
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
