/** Versioned wire messages shared by the managed Browser Host and client. */

export const MANAGED_BROWSER_PROTOCOL_VERSION = 2
/** Default delay before a hidden managed Browser surface releases its control connection. */
export const MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS = 15_000
export const BROWSER_STREAM_V2_HEADER_BYTES = 29
const MAX_BROWSER_CONTROL_MESSAGE_BYTES = 128 * 1024
const MAX_RTC_SDP_LENGTH = 64 * 1024
const MAX_RTC_CANDIDATE_LENGTH = 4 * 1024
const MAX_RTC_CANDIDATE_FIELD_LENGTH = 256

export type BrowserLayoutMode = 'fit' | 'phone' | 'tablet' | 'laptop'
export type BrowserSize = { width: number; height: number }

export type BrowserLayout = {
  revision: number
  mode: BrowserLayoutMode
  viewport: BrowserSize
  mediaGeneration: number
}

export type BrowserMediaIdentity = {
  ownerId: string
  revision: number
  mediaGeneration: number
}

export type BrowserRtcDescription = { type: 'offer' | 'answer'; sdp: string }
export type BrowserRtcCandidate = {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type BrowserInput =
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; selector?: string }
  | { type: 'tap'; x: number; y: number }
  | { type: 'down' | 'up' | 'move'; x: number; y: number; pressed?: boolean }
  | { type: 'keyDown' | 'keyUp'; key: string; code: string; modifiers?: number }
  | { type: 'text'; text: string }

export type BrowserClientMessage =
  | { type: 'hello'; version: 2; frameEncodings: Array<'binary-v2' | 'json-base64-v2'>; flowControl: ['frame-ack-v2']; media: { webrtcVideo: boolean } }
  | { type: 'layout-propose'; proposalSequence: number; mode: BrowserLayoutMode; viewport: BrowserSize }
  | { type: 'input'; revision: number; input: BrowserInput }
  | { type: 'frame-ack'; sequence: number; revision: number; mediaGeneration: number }
  | ({ type: 'rtc-answer'; description: BrowserRtcDescription } & BrowserMediaIdentity)
  | ({ type: 'rtc-candidate'; candidate: BrowserRtcCandidate | null } & BrowserMediaIdentity)
  | ({ type: 'media-retry'; trigger: 'explicit' | 'network-change' | 'tab-reactivate' } & BrowserMediaIdentity)
  | ({ type: 'media-decline'; reason: 'presentation-failed' } & BrowserMediaIdentity)
  | { type: 'outline' }

export type BrowserHostMessage =
  | BrowserReadyMessage
  | ({ type: 'rtc-offer'; description: BrowserRtcDescription } & BrowserMediaIdentity)
  | ({ type: 'rtc-candidate'; candidate: BrowserRtcCandidate | null } & BrowserMediaIdentity)

export type BrowserReadyMessage = {
  type: 'ready'
  version: 2
  frameEncoding: 'binary-v2' | 'json-base64-v2'
  flowControl: 'frame-ack-v2'
  fallback: { maxRawBytes: number }
  ownerId: string
  media: {
    preferredRoute: 'webrtc-direct' | 'jpeg-fallback'
    stunOnly: true
    negotiationTimeoutMs: number
    retryCooldownMs: number
    frameRate: number
    maxBitrate: number
    idleTimeoutMs: number
    hideGraceMs: number
  }
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
  if (!controlMessageWithinLimit(raw)) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!record(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'hello') {
    if (value.version !== MANAGED_BROWSER_PROTOCOL_VERSION || !Array.isArray(value.frameEncodings) || !Array.isArray(value.flowControl)
      || !record(value.media) || typeof value.media.webrtcVideo !== 'boolean') return undefined
    const frameEncodings = value.frameEncodings.filter((item): item is 'binary-v2' | 'json-base64-v2' => item === 'binary-v2' || item === 'json-base64-v2')
    if (frameEncodings.length !== value.frameEncodings.length || value.flowControl.length !== 1 || value.flowControl[0] !== 'frame-ack-v2') return undefined
    return { type: 'hello', version: 2, frameEncodings, flowControl: ['frame-ack-v2'], media: { webrtcVideo: value.media.webrtcVideo } }
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
  const identity = mediaIdentity(value)
  if (value.type === 'rtc-answer') {
    if (identity === undefined || !rtcDescription(value.description, 'answer')) return undefined
    return { type: 'rtc-answer', ...identity, description: value.description }
  }
  if (value.type === 'rtc-candidate') {
    if (identity === undefined || !rtcCandidateOrNull(value.candidate)) return undefined
    return { type: 'rtc-candidate', ...identity, candidate: value.candidate }
  }
  if (value.type === 'media-retry') {
    if (identity === undefined || (value.trigger !== 'explicit' && value.trigger !== 'network-change' && value.trigger !== 'tab-reactivate')) return undefined
    return { type: 'media-retry', ...identity, trigger: value.trigger }
  }
  if (value.type === 'media-decline') {
    if (identity === undefined || value.reason !== 'presentation-failed') return undefined
    return { type: 'media-decline', ...identity, reason: value.reason }
  }
  return value.type === 'outline' ? { type: 'outline' } : undefined
}

/** Decode one untrusted Host WebRTC signaling message. */
export function decodeBrowserHostMessage(raw: string): BrowserHostMessage | undefined {
  if (!controlMessageWithinLimit(raw)) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!record(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'ready') {
    if (value.version !== MANAGED_BROWSER_PROTOCOL_VERSION
      || (value.frameEncoding !== 'binary-v2' && value.frameEncoding !== 'json-base64-v2')
      || value.flowControl !== 'frame-ack-v2' || !record(value.fallback) || !positiveSafeInteger(value.fallback.maxRawBytes)
      || typeof value.ownerId !== 'string' || value.ownerId.length === 0 || value.ownerId.length > 256
      || !record(value.media) || (value.media.preferredRoute !== 'webrtc-direct' && value.media.preferredRoute !== 'jpeg-fallback')
      || value.media.stunOnly !== true || !positiveSafeInteger(value.media.negotiationTimeoutMs)
      || !nonNegativeSafeInteger(value.media.retryCooldownMs) || !positiveSafeInteger(value.media.frameRate)
      || !positiveSafeInteger(value.media.maxBitrate) || !positiveSafeInteger(value.media.idleTimeoutMs)
      || !nonNegativeSafeInteger(value.media.hideGraceMs)
      || !layoutPolicy(value.layoutPolicy)) return undefined
    return {
      type: 'ready', version: 2, frameEncoding: value.frameEncoding, flowControl: 'frame-ack-v2',
      fallback: { maxRawBytes: value.fallback.maxRawBytes }, ownerId: value.ownerId,
      media: {
        preferredRoute: value.media.preferredRoute, stunOnly: true,
        negotiationTimeoutMs: value.media.negotiationTimeoutMs, retryCooldownMs: value.media.retryCooldownMs,
        frameRate: value.media.frameRate, maxBitrate: value.media.maxBitrate,
        idleTimeoutMs: value.media.idleTimeoutMs, hideGraceMs: value.media.hideGraceMs,
      },
      layoutPolicy: value.layoutPolicy,
    }
  }
  const identity = mediaIdentity(value)
  if (identity === undefined) return undefined
  if (value.type === 'rtc-offer') {
    if (!rtcDescription(value.description, 'offer')) return undefined
    return { type: 'rtc-offer', ...identity, description: value.description }
  }
  if (value.type === 'rtc-candidate') {
    if (!rtcCandidateOrNull(value.candidate)) return undefined
    return { type: 'rtc-candidate', ...identity, candidate: value.candidate }
  }
  return undefined
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

function controlMessageWithinLimit(raw: string): boolean {
  return raw.length <= MAX_BROWSER_CONTROL_MESSAGE_BYTES
    && new TextEncoder().encode(raw).byteLength <= MAX_BROWSER_CONTROL_MESSAGE_BYTES
}

function mediaIdentity(value: Record<string, unknown>): BrowserMediaIdentity | undefined {
  if (typeof value.ownerId !== 'string' || value.ownerId.length === 0 || value.ownerId.length > 256
    || !positiveSafeInteger(value.revision) || !positiveSafeInteger(value.mediaGeneration)) return undefined
  return { ownerId: value.ownerId, revision: value.revision, mediaGeneration: value.mediaGeneration }
}

function rtcDescription(value: unknown, type: BrowserRtcDescription['type']): value is BrowserRtcDescription {
  return record(value) && value.type === type && typeof value.sdp === 'string'
    && value.sdp.length > 0 && value.sdp.length <= MAX_RTC_SDP_LENGTH
}

function rtcCandidateOrNull(value: unknown): value is BrowserRtcCandidate | null {
  if (value === null) return true
  return record(value) && typeof value.candidate === 'string' && value.candidate.length <= MAX_RTC_CANDIDATE_LENGTH
    && (value.sdpMid === undefined || value.sdpMid === null || (typeof value.sdpMid === 'string' && value.sdpMid.length <= MAX_RTC_CANDIDATE_FIELD_LENGTH))
    && (value.sdpMLineIndex === undefined || value.sdpMLineIndex === null || nonNegativeSafeInteger(value.sdpMLineIndex))
    && (value.usernameFragment === undefined || value.usernameFragment === null
      || (typeof value.usernameFragment === 'string' && value.usernameFragment.length <= MAX_RTC_CANDIDATE_FIELD_LENGTH))
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

function layoutPolicy(value: unknown): value is BrowserReadyMessage['layoutPolicy'] {
  return record(value) && size(value.minViewport) && size(value.maxViewport)
    && nonNegativeSafeInteger(value.settleMs) && nonNegativeSafeInteger(value.hysteresisPx)
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
