/** Authenticated same-origin screencast and input transport for managed Browser Tabs. */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { ManagedBrowserRuntime, ManagedBrowserTargetIdentity, ManagedCdpSession, ManagedTabKey } from './managed-browser-runtime.ts'
import {
  decodeBrowserClientMessage,
  encodeBrowserStreamFrameV2,
  encodeBrowserStreamJsonFrameV2,
  MANAGED_BROWSER_PROTOCOL_VERSION,
  MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS,
  MANAGED_BROWSER_MAX_RTC_CANDIDATES,
  type BrowserInput,
  type BrowserLayout,
  type BrowserSize,
  type BrowserStreamFrameV2,
  type BrowserRtcCandidate,
  type BrowserRtcDescription,
} from './managed-browser-protocol.ts'
import {
  MANAGED_BROWSER_DIRECT_VIDEO_FRAME_RATE,
  MANAGED_BROWSER_DIRECT_VIDEO_MAX_BITRATE,
  ManagedBrowserWebRtcEncoder,
  validateBrowserStunUrls,
  type BrowserMediaFrame,
  type BrowserMediaSignal,
  type ManagedBrowserWebRtcEncoderOptions,
} from './managed-browser-webrtc.ts'

export const MANAGED_BROWSER_STREAM_PATH = '/__dcs/browser-stream'
export const MANAGED_BROWSER_STREAM_VERSION = MANAGED_BROWSER_PROTOCOL_VERSION

const TICKET_TTL_MS = 30_000
const MAX_BUFFERED_BYTES = 512 * 1024
export const MANAGED_BROWSER_STREAM_SHUTDOWN_TIMEOUT_MS = 2_000
export const MANAGED_BROWSER_STREAM_HANDSHAKE_TIMEOUT_MS = 5_000
export const MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS = 100
export const MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME = 2
export const MANAGED_BROWSER_MOBILE_FRAME_INTERVAL_MS = 250
export const MANAGED_BROWSER_MOBILE_EVERY_NTH_FRAME = 4
const HIGH_DENSITY_SCALE = 1.5
export const MANAGED_BROWSER_MOBILE_MAX_RAW_BYTES = 96 * 1024
export const MANAGED_BROWSER_DESKTOP_MAX_RAW_BYTES = 480 * 1024
export const MANAGED_BROWSER_DIRECT_CAPTURE_MAX_RAW_BYTES = 480 * 1024
export const MANAGED_BROWSER_DESKTOP_INTERACTION_BURST_FRAMES = 20
export const MANAGED_BROWSER_MOBILE_INTERACTION_BURST_FRAMES = 4

export const MANAGED_BROWSER_STREAM_QUALITY = 80
export const MANAGED_BROWSER_DIRECT_CAPTURE_QUALITY = 80
export const MANAGED_BROWSER_DIRECT_CAPTURE_MAX_SCALE = 1.5
export const MANAGED_BROWSER_MOBILE_STREAM_QUALITY = 65
export const MANAGED_BROWSER_MEDIA_IDLE_TIMEOUT_MS = 5 * 60_000

export type BrowserStreamTransportProfile = {
  frameEncoding: 'binary-v2' | 'json-base64-v2'
  quality: number
  maxScale: number
  frameIntervalMs: number
  everyNthFrame: number
  interactionBurstFrames: number
  maxRawBytes: number
}

export type BrowserStreamProfileConfig = {
  desktopJpegMaxRawBytes?: number | undefined
  desktopJpegQuality?: number | undefined
  desktopJpegFrameIntervalMs?: number | undefined
  desktopJpegMaxScale?: number | undefined
  desktopScreencastEveryNthFrame?: number | undefined
  desktopJpegInteractionBurstFrames?: number | undefined
  mobileJpegMaxRawBytes?: number | undefined
  mobileJpegQuality?: number | undefined
  mobileJpegFrameIntervalMs?: number | undefined
  mobileJpegMaxScale?: number | undefined
  mobileScreencastEveryNthFrame?: number | undefined
  mobileJpegInteractionBurstFrames?: number | undefined
}

export type BrowserDirectCaptureProfileConfig = {
  directVideoCaptureQuality?: number | undefined
  directVideoCaptureMaxScale?: number | undefined
  directVideoCaptureMaxRawBytes?: number | undefined
}

export type BrowserDirectCaptureProfile = Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>

/** Resolve the encoder capture independently from the socket's fallback transport. */
export function browserDirectCaptureProfile(config: BrowserDirectCaptureProfileConfig = {}): BrowserDirectCaptureProfile {
  return {
    quality: jpegQuality(config.directVideoCaptureQuality, MANAGED_BROWSER_DIRECT_CAPTURE_QUALITY, 'directVideoCaptureQuality'),
    maxScale: jpegScale(config.directVideoCaptureMaxScale, MANAGED_BROWSER_DIRECT_CAPTURE_MAX_SCALE, 'directVideoCaptureMaxScale'),
    maxRawBytes: rawByteBudget(config.directVideoCaptureMaxRawBytes, MANAGED_BROWSER_DIRECT_CAPTURE_MAX_RAW_BYTES, 'directVideoCaptureMaxRawBytes'),
  }
}

export function browserStreamTransportProfile(
  route: 'desktop' | 'mobile',
  config: BrowserStreamProfileConfig = {},
): BrowserStreamTransportProfile {
  return route === 'mobile'
    ? {
        frameEncoding: 'json-base64-v2',
        quality: jpegQuality(config.mobileJpegQuality, MANAGED_BROWSER_MOBILE_STREAM_QUALITY, 'mobileJpegQuality'),
        maxScale: jpegScale(config.mobileJpegMaxScale, 1, 'mobileJpegMaxScale'),
        frameIntervalMs: positiveStreamInteger(config.mobileJpegFrameIntervalMs, MANAGED_BROWSER_MOBILE_FRAME_INTERVAL_MS, 'mobileJpegFrameIntervalMs'),
        everyNthFrame: positiveStreamInteger(config.mobileScreencastEveryNthFrame, MANAGED_BROWSER_MOBILE_EVERY_NTH_FRAME, 'mobileScreencastEveryNthFrame'),
        interactionBurstFrames: boundedStreamInteger(config.mobileJpegInteractionBurstFrames, MANAGED_BROWSER_MOBILE_INTERACTION_BURST_FRAMES, 0, 600, 'mobileJpegInteractionBurstFrames'),
        maxRawBytes: rawByteBudget(config.mobileJpegMaxRawBytes, MANAGED_BROWSER_MOBILE_MAX_RAW_BYTES),
      }
    : {
        frameEncoding: 'binary-v2',
        quality: jpegQuality(config.desktopJpegQuality, MANAGED_BROWSER_STREAM_QUALITY, 'desktopJpegQuality'),
        maxScale: jpegScale(config.desktopJpegMaxScale, HIGH_DENSITY_SCALE, 'desktopJpegMaxScale'),
        frameIntervalMs: positiveStreamInteger(config.desktopJpegFrameIntervalMs, MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS, 'desktopJpegFrameIntervalMs'),
        everyNthFrame: positiveStreamInteger(config.desktopScreencastEveryNthFrame, MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME, 'desktopScreencastEveryNthFrame'),
        interactionBurstFrames: boundedStreamInteger(config.desktopJpegInteractionBurstFrames, MANAGED_BROWSER_DESKTOP_INTERACTION_BURST_FRAMES, 0, 600, 'desktopJpegInteractionBurstFrames'),
        maxRawBytes: rawByteBudget(config.desktopJpegMaxRawBytes, MANAGED_BROWSER_DESKTOP_MAX_RAW_BYTES),
      }
}

/** Calculates the next capture delay without allowing priority requests to bypass the route FPS ceiling. */
export function browserStreamCaptureDelay(
  lastCapturedAt: number | undefined,
  now: number,
  frameIntervalMs: number,
): number {
  if (lastCapturedAt === undefined) return 0
  return Math.max(0, frameIntervalMs - (now - lastCapturedAt))
}

/** Bounds passive screencast-driven fallback frames after explicit Browser activity. */
export class BrowserFallbackActivityBudget {
  #limit: number
  #remaining = 0

  constructor(limit: number) {
    this.#limit = boundedStreamInteger(limit, 0, 0, 600, 'jpegInteractionBurstFrames')
  }

  activate(): void {
    this.#remaining = this.#limit
  }

  takePassive(directVideo = false): boolean {
    if (directVideo) return true
    if (this.#remaining === 0) return false
    this.#remaining -= 1
    return true
  }

  remaining(): number {
    return this.#remaining
  }
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
  desktopMaxRawBytes?: number
  mobileMaxRawBytes?: number
  desktopJpegQuality?: number
  desktopJpegFrameIntervalMs?: number
  desktopJpegMaxScale?: number
  desktopScreencastEveryNthFrame?: number
  desktopJpegInteractionBurstFrames?: number
  mobileJpegQuality?: number
  mobileJpegFrameIntervalMs?: number
  mobileJpegMaxScale?: number
  mobileScreencastEveryNthFrame?: number
  mobileJpegInteractionBurstFrames?: number
  preferredMediaRoute?: 'webrtc-preferred' | 'jpeg-only'
  stunUrls?: string[]
  webrtcNegotiationTimeoutMs?: number
  webrtcRetryCooldownMs?: number
  maxMediaPeers?: number
  maxEncoderPages?: number
  directVideoFrameRate?: number
  directVideoMaxBitrate?: number
  directVideoCaptureQuality?: number
  directVideoCaptureMaxScale?: number
  directVideoCaptureMaxRawBytes?: number
  mediaIdleTimeoutMs?: number
  mediaHideGraceMs?: number
  shutdownTimeoutMs?: number
  encoderFactory?: ManagedBrowserWebRtcEncoderFactory
}

export type ManagedBrowserWebRtcEncoderLike = {
  start(): Promise<BrowserRtcDescription>
  acceptAnswer(description: BrowserRtcDescription): Promise<void>
  addCandidate(candidate: BrowserRtcCandidate | null): Promise<void>
  submit(frame: BrowserMediaFrame): boolean
  dispose(): Promise<void>
}

export type ManagedBrowserWebRtcEncoderFactory = (options: ManagedBrowserWebRtcEncoderOptions) => ManagedBrowserWebRtcEncoderLike

type ScreencastPayload = {
  data?: unknown
  sessionId?: unknown
}

type BrowserMediaAttempt = {
  layout: BrowserLayout
  encoder: ManagedBrowserWebRtcEncoderLike
  connected: boolean
  answerStarted: boolean
  answerAccepted: boolean
  inboundCandidateCount: number
  outboundCandidateCount: number
  candidates: Array<BrowserRtcCandidate | null>
  negotiationTimer: ReturnType<typeof setTimeout> | undefined
  idleTimer: ReturnType<typeof setTimeout> | undefined
  submittedAt: Map<number, number>
  capacityOwner: BrowserMediaCapacityOwner
  released: boolean
}

type BrowserMediaCapacityOwner = {
  ownerId: string
  order: number
  evictionPriority(): 0 | 1 | undefined
  evict(): Promise<boolean>
}

type BrowserTabConnection = {
  socket: WebSocket
  cleanup(): Promise<void>
}

export type { BrowserInput } from './managed-browser-protocol.ts'

export type ManagedBrowserStreamResources = {
  sockets: number
  timers: number
  captures: number
  unackedFrames: number
  peers: number
}

export type ManagedBrowserMediaRouteDiagnostic = {
  route: 'jpeg-fallback' | 'webrtc-direct'
  status: 'active' | 'degraded' | 'reconnecting'
  reason?: string
}

export type ManagedBrowserLatencyDiagnostic = {
  samples: number
  totalMs: number
  lastMs: number
  maxMs: number
}

export type ManagedBrowserStreamDiagnostics = {
  layoutProposals: number
  layoutCommits: number
  staleInputs: number
  staleCaptureDrops: number
  fallbackBytes: number
  fallbackRecaptures: number
  encodedBytes: number
  routeBudgetDrops: number
  mediaAttempts: number
  mediaFailures: number
  currentViewportRevision: number | undefined
  currentMediaGeneration: number | undefined
  captureLatencyMs: ManagedBrowserLatencyDiagnostic
  encodeLatencyMs: ManagedBrowserLatencyDiagnostic
  sendLatencyMs: ManagedBrowserLatencyDiagnostic
  encoderPaintLatencyMs: ManagedBrowserLatencyDiagnostic
  fallbackAckEndToEndLatencyMs: ManagedBrowserLatencyDiagnostic
  activePeers: number
  activeEncoderPages: number
  activeCaptures: number
  activeSockets: number
  activeTimers: number
  lastMediaRoute: ManagedBrowserMediaRouteDiagnostic | undefined
  mediaRouteReasons: Record<string, number>
}

export class ManagedBrowserStream {
  #runtime: ManagedBrowserRuntime
  #now: () => number
  #ticketTtlMs: number
  #handshakeTimeoutMs: number
  #tickets = new Map<string, StreamTicket>()
  #server = new WebSocketServer({ noServer: true })
  #sockets = new Set<WebSocket>()
  #tabConnections = new Map<string, BrowserTabConnection>()
  #socketCleanup = new Map<WebSocket, () => Promise<void>>()
  #timerCount = 0
  #captureCount = 0
  #unackedCount = 0
  #profiles: { desktop: BrowserStreamTransportProfile; mobile: BrowserStreamTransportProfile }
  #directCaptureProfile: BrowserDirectCaptureProfile
  #tasks = new Set<Promise<void>>()
  #preferredMediaRoute: 'webrtc-preferred' | 'jpeg-only'
  #stunUrls: string[]
  #webrtcNegotiationTimeoutMs: number
  #webrtcRetryCooldownMs: number
  #maxMediaPeers: number
  #directVideoFrameRate: number
  #directVideoMaxBitrate: number
  #mediaIdleTimeoutMs: number
  #mediaHideGraceMs: number
  #shutdownTimeoutMs: number
  #encoderFactory: ManagedBrowserWebRtcEncoderFactory
  #peerCount = 0
  #mediaCapacityOwners = new Map<string, BrowserMediaCapacityOwner>()
  #mediaCapacityOrder = 0
  #mediaCapacityTransition = Promise.resolve()
  #diagnostics: ManagedBrowserStreamDiagnostics = {
    layoutProposals: 0,
    layoutCommits: 0,
    staleInputs: 0,
    staleCaptureDrops: 0,
    fallbackBytes: 0,
    fallbackRecaptures: 0,
    encodedBytes: 0,
    routeBudgetDrops: 0,
    mediaAttempts: 0,
    mediaFailures: 0,
    currentViewportRevision: undefined,
    currentMediaGeneration: undefined,
    captureLatencyMs: emptyLatencyDiagnostic(),
    encodeLatencyMs: emptyLatencyDiagnostic(),
    sendLatencyMs: emptyLatencyDiagnostic(),
    encoderPaintLatencyMs: emptyLatencyDiagnostic(),
    fallbackAckEndToEndLatencyMs: emptyLatencyDiagnostic(),
    activePeers: 0,
    activeEncoderPages: 0,
    activeCaptures: 0,
    activeSockets: 0,
    activeTimers: 0,
    lastMediaRoute: undefined,
    mediaRouteReasons: {},
  }
  #disposePromise: Promise<void> | undefined

  constructor(opts: ManagedBrowserStreamOptions) {
    this.#runtime = opts.runtime
    this.#now = opts.now ?? Date.now
    this.#ticketTtlMs = opts.ticketTtlMs ?? TICKET_TTL_MS
    this.#handshakeTimeoutMs = opts.handshakeTimeoutMs ?? MANAGED_BROWSER_STREAM_HANDSHAKE_TIMEOUT_MS
    const profileConfig: BrowserStreamProfileConfig = {
      desktopJpegMaxRawBytes: opts.desktopMaxRawBytes,
      desktopJpegQuality: opts.desktopJpegQuality,
      desktopJpegFrameIntervalMs: opts.desktopJpegFrameIntervalMs,
      desktopJpegMaxScale: opts.desktopJpegMaxScale,
      desktopScreencastEveryNthFrame: opts.desktopScreencastEveryNthFrame,
      desktopJpegInteractionBurstFrames: opts.desktopJpegInteractionBurstFrames,
      mobileJpegMaxRawBytes: opts.mobileMaxRawBytes,
      mobileJpegQuality: opts.mobileJpegQuality,
      mobileJpegFrameIntervalMs: opts.mobileJpegFrameIntervalMs,
      mobileJpegMaxScale: opts.mobileJpegMaxScale,
      mobileScreencastEveryNthFrame: opts.mobileScreencastEveryNthFrame,
      mobileJpegInteractionBurstFrames: opts.mobileJpegInteractionBurstFrames,
    }
    this.#profiles = {
      desktop: browserStreamTransportProfile('desktop', profileConfig),
      mobile: browserStreamTransportProfile('mobile', profileConfig),
    }
    this.#directCaptureProfile = browserDirectCaptureProfile({
      directVideoCaptureQuality: opts.directVideoCaptureQuality,
      directVideoCaptureMaxScale: opts.directVideoCaptureMaxScale,
      directVideoCaptureMaxRawBytes: opts.directVideoCaptureMaxRawBytes,
    })
    this.#preferredMediaRoute = opts.preferredMediaRoute ?? 'webrtc-preferred'
    if (this.#preferredMediaRoute !== 'webrtc-preferred' && this.#preferredMediaRoute !== 'jpeg-only') throw new Error('managedBrowser preferredMediaRoute is invalid')
    this.#stunUrls = validateBrowserStunUrls(opts.stunUrls ?? [])
    this.#webrtcNegotiationTimeoutMs = positiveStreamInteger(opts.webrtcNegotiationTimeoutMs, 5_000, 'webrtcNegotiationTimeoutMs')
    this.#webrtcRetryCooldownMs = nonNegativeStreamInteger(opts.webrtcRetryCooldownMs, 30_000, 'webrtcRetryCooldownMs')
    this.#maxMediaPeers = positiveStreamInteger(opts.maxMediaPeers, 3, 'maxMediaPeers')
    const maxEncoderPages = positiveStreamInteger(opts.maxEncoderPages, 3, 'maxEncoderPages')
    if (this.#maxMediaPeers > maxEncoderPages) throw new Error('managedBrowser maxMediaPeers cannot exceed maxEncoderPages')
    this.#directVideoFrameRate = boundedStreamInteger(opts.directVideoFrameRate, MANAGED_BROWSER_DIRECT_VIDEO_FRAME_RATE, 1, 60, 'directVideoFrameRate')
    this.#directVideoMaxBitrate = boundedStreamInteger(opts.directVideoMaxBitrate, MANAGED_BROWSER_DIRECT_VIDEO_MAX_BITRATE, 1, 100_000_000, 'directVideoMaxBitrate')
    this.#mediaIdleTimeoutMs = positiveStreamInteger(opts.mediaIdleTimeoutMs, MANAGED_BROWSER_MEDIA_IDLE_TIMEOUT_MS, 'mediaIdleTimeoutMs')
    this.#mediaHideGraceMs = nonNegativeStreamInteger(opts.mediaHideGraceMs, MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS, 'mediaHideGraceMs')
    this.#shutdownTimeoutMs = positiveStreamInteger(opts.shutdownTimeoutMs, MANAGED_BROWSER_STREAM_SHUTDOWN_TIMEOUT_MS, 'shutdownTimeoutMs')
    this.#encoderFactory = opts.encoderFactory ?? ((options) => new ManagedBrowserWebRtcEncoder(options))
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
      const profile = typeof req.headers.origin === 'string' && req.headers.origin.length > 0 ? this.#profiles.desktop : this.#profiles.mobile
      void this.#attach(ws, tab, target, profile)
    })
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#dispose()
    return this.#disposePromise
  }

  closeTab(tab: ManagedTabKey): void {
    this.#tabConnections.get(this.#runtime.keyOf(tab))?.socket.close(1000, 'Browser Tab closed')
  }

  closeSession(sessionId: string): void {
    for (const [key, connection] of this.#tabConnections) {
      if (key.startsWith(sessionId + ':')) connection.socket.close(1000, 'Browser session disposed')
    }
  }

  resources(): ManagedBrowserStreamResources {
    return {
      sockets: this.#sockets.size,
      timers: this.#timerCount,
      captures: this.#captureCount,
      unackedFrames: this.#unackedCount,
      peers: this.#peerCount,
    }
  }

  /** Return cumulative protocol/media counters without changing owned-resource accounting. */
  diagnostics(): ManagedBrowserStreamDiagnostics {
    return {
      ...this.#diagnostics,
      captureLatencyMs: { ...this.#diagnostics.captureLatencyMs },
      encodeLatencyMs: { ...this.#diagnostics.encodeLatencyMs },
      sendLatencyMs: { ...this.#diagnostics.sendLatencyMs },
      encoderPaintLatencyMs: { ...this.#diagnostics.encoderPaintLatencyMs },
      fallbackAckEndToEndLatencyMs: { ...this.#diagnostics.fallbackAckEndToEndLatencyMs },
      activePeers: this.#peerCount,
      activeEncoderPages: this.#runtime.mediaPageCount(),
      activeCaptures: this.#captureCount,
      activeSockets: this.#sockets.size,
      activeTimers: this.#timerCount,
      lastMediaRoute: this.#diagnostics.lastMediaRoute === undefined ? undefined : { ...this.#diagnostics.lastMediaRoute },
      mediaRouteReasons: { ...this.#diagnostics.mediaRouteReasons },
    }
  }

  async #dispose(): Promise<void> {
    const sockets = [...this.#sockets]
    this.#tickets.clear()
    for (const socket of sockets) {
      socket.close(1001, 'Plugin disposed')
      const cleanup = this.#socketCleanup.get(socket)
      if (cleanup !== undefined) this.#track(cleanup())
    }
    const serverClosed = new Promise<void>((resolve) => { this.#server.close(() => resolve()) })
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(() => {
        deadlineTimer = undefined
        for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
        resolve()
      }, this.#shutdownTimeoutMs)
    })
    await Promise.race([serverClosed, deadline])
    await Promise.race([this.#drainTasks(), deadline])
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
    this.#sockets.clear()
    this.#tabConnections.clear()
    this.#socketCleanup.clear()
    this.#mediaCapacityOwners.clear()
    this.#peerCount = 0
    this.#tasks.clear()
  }

  async #drainTasks(): Promise<void> {
    while (this.#tasks.size > 0) await Promise.allSettled([...this.#tasks])
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
    target: { identity: ManagedBrowserTargetIdentity; cdp: ManagedCdpSession; layout: BrowserLayout },
    profile: BrowserStreamTransportProfile,
  ): Promise<void> {
    const cdp = target.cdp
    const tabKey = this.#runtime.keyOf(tab)
    const previous = this.#tabConnections.get(tabKey)
    let cleanupPromise: Promise<void> | undefined
    const connection: BrowserTabConnection = {
      socket,
      cleanup: () => cleanupPromise ??= detach(),
    }
    this.#tabConnections.set(tabKey, connection)
    if (previous !== undefined && previous.socket.readyState !== WebSocket.CLOSED) {
      previous.socket.close(4001, 'Replaced by a newer stream')
    }
    const previousCleanup = previous?.cleanup() ?? Promise.resolve()
    this.#sockets.add(socket)
    let sequence = 0
    let lastFrameAt: number | undefined
    let lastProjection = ''
    let lastLayout = ''
    let captureInFlight = false
    let captureOwned = false
    let captureTask: Promise<void> | undefined
    let unacked: { sequence: number; revision: number; mediaGeneration: number; sentAt: number } | undefined
    let dirty: { kind: 'activity' | 'passive' } | undefined
    let frameTimer: ReturnType<typeof setTimeout> | undefined
    let sourceAttached = false
    let handshaken = false
    let detached = false
    let latestProposalSequence = 0
    let mediaDegraded = false
    const ownerId = randomBytes(18).toString('base64url')
    let clientWebRtc = false
    let mediaAttempt: BrowserMediaAttempt | undefined
    let mediaFrameSequence = 0
    let lastMediaFailureAt = Number.NEGATIVE_INFINITY
    let lastMediaRetryAt = Number.NEGATIVE_INFINITY
    let mediaIdleSuspended = false
    let mediaStarted = false
    let surfaceHidden = false
    let mediaTransition = Promise.resolve()
    let activated = false
    let startTask: Promise<void> | undefined
    let noteMediaActivity = (): void => {}
    const fallbackActivity = new BrowserFallbackActivityBudget(profile.interactionBurstFrames)
    const currentTarget = (): ReturnType<ManagedBrowserRuntime['target']> => {
      const current = this.#runtime.target(tab, target.identity)
      if (current?.identity === target.identity) return current
      if (!detached && socket.readyState === WebSocket.OPEN) socket.close(4002, 'Browser target replaced')
      return undefined
    }
    const currentLayout = (): BrowserLayout | undefined => currentTarget()?.layout
    let releaseLease: (() => void) | undefined
    const sendProjection = (): boolean => {
      if (socket.readyState !== WebSocket.OPEN) return false
      if (currentTarget() === undefined) return false
      const projection = this.#runtime.projection(tab)
      if (projection === undefined) return false
      const signature = projection.documentId + ':' + projection.status + ':' + projection.url + ':' + projection.title
      if (signature === lastProjection) return false
      lastProjection = signature
      socket.send(JSON.stringify({ type: 'state', projection }))
      return true
    }
    const sendLayout = (layout: BrowserLayout): void => {
      this.#diagnostics.currentViewportRevision = layout.revision
      this.#diagnostics.currentMediaGeneration = layout.mediaGeneration
      const signature = layout.revision + ':' + layout.mediaGeneration
      if (signature === lastLayout || socket.readyState !== WebSocket.OPEN) return
      lastLayout = signature
      socket.send(JSON.stringify({ type: 'layout-commit', layout }))
    }
    const sendFrame = (capture: BrowserJpegCapture, layout: BrowserLayout): boolean => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return false
      sequence += 1
      const frame: BrowserStreamFrameV2 = {
        version: 2,
        sequence,
        sentAt: this.#now(),
        revision: layout.revision,
        mediaGeneration: layout.mediaGeneration,
        viewport: layout.viewport,
        encodedSize: capture.encodedSize,
        jpeg: capture.jpeg,
      }
      const encodeStartedAt = this.#now()
      const payload = profile.frameEncoding === 'binary-v2'
        ? encodeBrowserStreamFrameV2(frame)
        : encodeBrowserStreamJsonFrameV2(frame)
      recordLatency(this.#diagnostics.encodeLatencyMs, this.#now() - encodeStartedAt)
      const sendStartedAt = this.#now()
      try {
        socket.send(payload, (error) => {
          if (detached || this.#tabConnections.get(tabKey) !== connection) return
          // ws can report a successful flush as null even though @types/ws declares only Error | undefined.
          if (error != null) {
            socket.close(1011, 'Browser frame send failed')
            return
          }
          recordLatency(this.#diagnostics.sendLatencyMs, this.#now() - sendStartedAt)
        })
      } catch {
        return false
      }
      unacked = { sequence, revision: layout.revision, mediaGeneration: layout.mediaGeneration, sentAt: this.#now() }
      this.#unackedCount += 1
      return true
    }
    const releaseCapture = (): void => {
      if (!captureOwned) return
      captureOwned = false
      this.#captureCount -= 1
    }
    const armFrameTimer = (delay: number, pump: () => void): void => {
      if (frameTimer !== undefined) return
      this.#timerCount += 1
      frameTimer = setTimeout(() => {
        frameTimer = undefined
        this.#timerCount -= 1
        pump()
      }, Math.max(1, delay))
      frameTimer.unref()
    }
    const pump = (): void => {
      if (detached || !handshaken || socket.readyState !== WebSocket.OPEN) return
      if (captureInFlight || unacked !== undefined || dirty === undefined) return
      const activeFrameIntervalMs = mediaAttempt?.connected === true
        ? Math.ceil(1000 / this.#directVideoFrameRate)
        : profile.frameIntervalMs
      const directVideo = mediaAttempt?.connected === true
      const delay = browserStreamCaptureDelay(lastFrameAt, this.#now(), activeFrameIntervalMs)
      if (delay > 0) {
        armFrameTimer(delay, pump)
        return
      }
      if (frameTimer !== undefined) {
        clearTimeout(frameTimer)
        frameTimer = undefined
        this.#timerCount -= 1
      }
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        armFrameTimer(activeFrameIntervalMs, pump)
        return
      }
      if (dirty.kind === 'passive' && !fallbackActivity.takePassive(directVideo)) {
        this.#diagnostics.routeBudgetDrops += 1
        dirty = undefined
        return
      }
      dirty = undefined
      lastFrameAt = this.#now()
      captureInFlight = true
      captureOwned = true
      this.#captureCount += 1
      const capturedLayout = currentLayout()
      if (capturedLayout === undefined) {
        captureInFlight = false
        releaseCapture()
        return
      }
      const captureRoute = directVideo ? 'webrtc-direct' : 'jpeg-fallback'
      const captureProfile = directVideo ? this.#directCaptureProfile : profile
      const captureStartedAt = this.#now()
      const task = captureBrowserJpegForLayout(cdp, capturedLayout, currentLayout, captureProfile, {
        onCaptureAttempt: (attemptIndex) => {
          if (captureRoute === 'jpeg-fallback' && attemptIndex > 0) this.#diagnostics.fallbackRecaptures += 1
        },
        onStaleDrop: () => { this.#diagnostics.staleCaptureDrops += 1 },
      }).then((capture) => {
        recordLatency(this.#diagnostics.captureLatencyMs, this.#now() - captureStartedAt)
        if (detached) return
        if (capture === undefined) {
          const current = currentLayout()
          if (current?.revision !== capturedLayout.revision || current.mediaGeneration !== capturedLayout.mediaGeneration) return
          this.#diagnostics.routeBudgetDrops += 1
          if (captureRoute === 'webrtc-direct') {
            const attempt = mediaAttempt
            if (attempt?.connected === true && sameMediaLayout(attempt.layout, capturedLayout)) {
              this.#track(failMediaAttempt(attempt, 'direct-frame-budget-exceeded'))
            }
            return
          }
          if (!mediaDegraded && socket.readyState === WebSocket.OPEN) {
            mediaDegraded = true
            sendMediaRoute('jpeg-fallback', 'degraded', 'frame-budget-exceeded')
          }
          return
        }
        this.#diagnostics.encodedBytes = Math.min(Number.MAX_SAFE_INTEGER, this.#diagnostics.encodedBytes + capture.jpeg.byteLength)
        if (mediaDegraded && socket.readyState === WebSocket.OPEN) {
          mediaDegraded = false
          sendMediaRoute('jpeg-fallback', 'active')
        }
        const attempt = mediaAttempt
        if (captureRoute === 'webrtc-direct') {
          if (attempt?.connected === true && sameMediaLayout(attempt.layout, capturedLayout)) {
            mediaFrameSequence += 1
            const submitted = attempt.encoder.submit({
              sequence: mediaFrameSequence,
              width: capture.encodedSize.width,
              height: capture.encodedSize.height,
              jpeg: capture.jpeg,
            })
            if (submitted) {
              attempt.submittedAt.set(mediaFrameSequence, this.#now())
              while (attempt.submittedAt.size > 2) {
                const oldest = attempt.submittedAt.keys().next().value as number | undefined
                if (oldest === undefined) break
                attempt.submittedAt.delete(oldest)
              }
            }
          }
          return
        }
        if (attempt?.connected === true && sameMediaLayout(attempt.layout, capturedLayout)) return
        if (sendFrame(capture, capturedLayout)) {
          this.#diagnostics.fallbackBytes += capture.jpeg.byteLength
        } else {
          dirty = { kind: 'activity' }
        }
      }).finally(() => {
        if (captureTask === task) captureTask = undefined
        captureInFlight = false
        releaseCapture()
        pump()
      })
      captureTask = task
      this.#track(task)
    }
    const requestFrame = (kind: 'activity' | 'passive'): void => {
      if (detached || socket.readyState !== WebSocket.OPEN) return
      if (kind === 'activity') fallbackActivity.activate()
      dirty = { kind: kind === 'activity' || dirty?.kind === 'activity' ? 'activity' : 'passive' }
      pump()
    }
    const clearMediaTimer = (attempt: BrowserMediaAttempt, field: 'negotiationTimer' | 'idleTimer'): void => {
      const timer = attempt[field]
      if (timer === undefined) return
      clearTimeout(timer)
      attempt[field] = undefined
      this.#timerCount -= 1
    }
    const releaseMediaAttempt = async (attempt: BrowserMediaAttempt): Promise<void> => {
      clearMediaTimer(attempt, 'negotiationTimer')
      clearMediaTimer(attempt, 'idleTimer')
      if (attempt.released) return
      attempt.released = true
      attempt.submittedAt.clear()
      this.#releaseMediaCapacity(attempt.capacityOwner)
      await attempt.encoder.dispose().catch(() => undefined)
    }
    const sendMediaRoute = (route: 'jpeg-fallback' | 'webrtc-direct', status: 'active' | 'degraded' | 'reconnecting', reason?: string): void => {
      this.#diagnostics.lastMediaRoute = { route, status, ...(reason === undefined ? {} : { reason }) }
      if (reason !== undefined) this.#diagnostics.mediaRouteReasons[reason] = (this.#diagnostics.mediaRouteReasons[reason] ?? 0) + 1
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'media-route', route, status, ...(reason === undefined ? {} : { reason }) }))
    }
    const failMediaAttempt = async (attempt: BrowserMediaAttempt, reason: string): Promise<void> => {
      if (mediaAttempt !== attempt) return
      mediaAttempt = undefined
      lastMediaFailureAt = this.#now()
      this.#diagnostics.mediaFailures += 1
      mediaIdleSuspended = reason === 'media-idle-timeout'
      await releaseMediaAttempt(attempt)
      if (detached) return
      sendMediaRoute('jpeg-fallback', 'degraded', reason)
      requestFrame('activity')
    }
    const handleMediaSignal = (attempt: BrowserMediaAttempt, message: BrowserMediaSignal): void => {
      if (mediaAttempt !== attempt || detached || message.ownerId !== ownerId || message.generation !== attempt.layout.mediaGeneration) return
      const signal = message.signal
      if (signal.type === 'candidate') {
        if (attempt.outboundCandidateCount >= MANAGED_BROWSER_MAX_RTC_CANDIDATES) return
        attempt.outboundCandidateCount += 1
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
          type: 'rtc-candidate', ownerId, revision: attempt.layout.revision,
          mediaGeneration: attempt.layout.mediaGeneration, candidate: signal.candidate,
        }))
        return
      }
      if (signal.type === 'connection-state') {
        if (signal.state === 'connected') {
          attempt.connected = true
          clearMediaTimer(attempt, 'negotiationTimer')
          noteMediaActivity()
          if (unacked !== undefined) {
            unacked = undefined
            this.#unackedCount -= 1
          }
          sendMediaRoute('webrtc-direct', 'active')
          requestFrame('activity')
        } else if (signal.state === 'disconnected' || signal.state === 'failed' || signal.state === 'closed') {
          this.#track(failMediaAttempt(attempt, 'peer-' + signal.state))
        }
        return
      }
      if (signal.type === 'frame-painted') {
        const submittedAt = attempt.submittedAt.get(signal.sequence)
        if (submittedAt !== undefined) {
          recordLatency(this.#diagnostics.encoderPaintLatencyMs, this.#now() - submittedAt)
          for (const sequence of attempt.submittedAt.keys()) if (sequence <= signal.sequence) attempt.submittedAt.delete(sequence)
        }
        return
      }
      if (signal.type === 'encoder-error') this.#track(failMediaAttempt(attempt, 'encoder-error'))
    }
    const startMediaAttempt = async (layout: BrowserLayout): Promise<void> => {
      if (detached || !clientWebRtc || this.#preferredMediaRoute === 'jpeg-only' || !sameMediaLayout(currentLayout(), layout)) return
      this.#diagnostics.mediaAttempts += 1
      let attempt: BrowserMediaAttempt | undefined
      const capacityOwner = await this.#reserveMediaCapacity((order) => {
        let owner: BrowserMediaCapacityOwner
        const encoder = this.#encoderFactory({
          identity: { ownerId, generation: layout.mediaGeneration },
          pageFactory: () => this.#runtime.createMediaPage(),
          stunUrls: this.#stunUrls,
          width: layout.viewport.width,
          height: layout.viewport.height,
          frameRate: this.#directVideoFrameRate,
          maxBitrate: this.#directVideoMaxBitrate,
          onSignal: (message) => { if (attempt !== undefined) handleMediaSignal(attempt, message) },
        })
        owner = {
          ownerId,
          order,
          evictionPriority: () => attempt === undefined || attempt.released
            ? undefined
            : surfaceHidden ? 0 : attempt.connected ? undefined : 1,
          evict: async () => {
            const target = attempt
            if (target === undefined || mediaAttempt !== target || target.released || (!surfaceHidden && target.connected)) return false
            await failMediaAttempt(target, 'local-capacity-evicted')
            return target.released
          },
        }
        attempt = {
          layout: { ...layout, viewport: { ...layout.viewport } }, encoder, connected: false,
          answerStarted: false, answerAccepted: false, inboundCandidateCount: 0, outboundCandidateCount: 0, candidates: [],
          negotiationTimer: undefined, idleTimer: undefined, submittedAt: new Map(), capacityOwner: owner, released: false,
        }
        mediaAttempt = attempt
        return owner
      })
      if (capacityOwner === undefined || attempt === undefined) {
        lastMediaFailureAt = this.#now()
        this.#diagnostics.mediaFailures += 1
        sendMediaRoute('jpeg-fallback', 'degraded', 'local-capacity')
        requestFrame('activity')
        return
      }
      if (detached || mediaAttempt !== attempt || !sameMediaLayout(currentLayout(), layout)) {
        if (mediaAttempt === attempt) mediaAttempt = undefined
        await releaseMediaAttempt(attempt)
        return
      }
      const activeAttempt = attempt
      mediaIdleSuspended = false
      this.#timerCount += 1
      activeAttempt.negotiationTimer = setTimeout(() => {
        activeAttempt.negotiationTimer = undefined
        this.#timerCount -= 1
        this.#track(failMediaAttempt(activeAttempt, 'negotiation-timeout'))
      }, this.#webrtcNegotiationTimeoutMs)
      activeAttempt.negotiationTimer.unref()
      sendMediaRoute('jpeg-fallback', 'reconnecting')
      try {
        const offer = await activeAttempt.encoder.start()
        if (mediaAttempt !== activeAttempt || detached || !sameMediaLayout(currentLayout(), layout)) return
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
          type: 'rtc-offer', ownerId, revision: layout.revision, mediaGeneration: layout.mediaGeneration, description: offer,
        }))
      } catch {
        await failMediaAttempt(activeAttempt, 'encoder-start-failed')
      }
    }
    const replaceMediaAttempt = (layout: BrowserLayout): void => {
      const task = mediaTransition.then(async () => {
        const previousAttempt = mediaAttempt
        mediaAttempt = undefined
        if (previousAttempt !== undefined) await releaseMediaAttempt(previousAttempt)
        await startMediaAttempt(layout)
      })
      mediaTransition = task.catch(() => undefined)
      this.#track(task)
    }
    noteMediaActivity = (): void => {
      const attempt = mediaAttempt
      if (attempt?.connected === true) {
        clearMediaTimer(attempt, 'idleTimer')
        this.#timerCount += 1
        attempt.idleTimer = setTimeout(() => {
          attempt.idleTimer = undefined
          this.#timerCount -= 1
          this.#track(failMediaAttempt(attempt, 'media-idle-timeout'))
        }, this.#mediaIdleTimeoutMs)
        attempt.idleTimer.unref()
        return
      }
      if (!mediaIdleSuspended || attempt !== undefined || this.#now() - lastMediaFailureAt < this.#webrtcRetryCooldownMs) return
      const layout = currentLayout()
      if (layout === undefined) return
      mediaIdleSuspended = false
      replaceMediaAttempt(layout)
    }
    const startCommittedMedia = async (layout: BrowserLayout): Promise<void> => {
      if (mediaStarted || detached) return
      mediaStarted = true
      sourceAttached = true
      cdp.on('Page.screencastFrame', onFrame)
      sendLayout(layout)
      sendMediaRoute('jpeg-fallback', clientWebRtc && this.#preferredMediaRoute === 'webrtc-preferred' ? 'reconnecting' : 'active')
      replaceMediaAttempt(layout)
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
        requestFrame('activity')
      } catch (error) {
        if (!detached) socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : 'Cannot start screencast')
      }
    }
    const commitLayout = (layout: BrowserLayout): void => {
      this.#diagnostics.layoutCommits += 1
      if (unacked !== undefined
        && (unacked.revision !== layout.revision || unacked.mediaGeneration !== layout.mediaGeneration)) {
        unacked = undefined
        this.#unackedCount -= 1
      }
      if (!mediaStarted) {
        this.#track(startCommittedMedia(layout))
        return
      }
      sendLayout(layout)
      replaceMediaAttempt(layout)
      requestFrame('activity')
    }
    const onFrame = (value: unknown): void => {
      const payload = value as ScreencastPayload
      const projectionChanged = sendProjection()
      if (typeof payload.sessionId === 'number') void cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined)
      this.#runtime.touch(tab)
      if (typeof payload.data === 'string') noteMediaActivity()
      if (typeof payload.data === 'string') requestFrame(projectionChanged ? 'activity' : 'passive')
    }
    const detach = async (): Promise<void> => {
      if (detached) return
      detached = true
      clearHelloTimer()
      if (frameTimer !== undefined) {
        clearTimeout(frameTimer)
        this.#timerCount -= 1
      }
      frameTimer = undefined
      if (sourceAttached) cdp.off('Page.screencastFrame', onFrame)
      this.#sockets.delete(socket)
      this.#socketCleanup.delete(socket)
      if (this.#tabConnections.get(tabKey) === connection) this.#tabConnections.delete(tabKey)
      dirty = undefined
      if (unacked !== undefined) this.#unackedCount -= 1
      unacked = undefined
      captureInFlight = false
      releaseCapture()
      const attempt = mediaAttempt
      mediaAttempt = undefined
      releaseLease?.()
      releaseLease = undefined
      const releaseMedia = attempt === undefined ? Promise.resolve() : releaseMediaAttempt(attempt)
      const stopScreencast = sourceAttached
        ? cdp.send('Page.stopScreencast').then(() => undefined).catch(() => undefined)
        : Promise.resolve()
      await Promise.all([previousCleanup, mediaTransition, releaseMedia, stopScreencast, captureTask, startTask])
    }
    const start = async (): Promise<void> => {
      socket.send(JSON.stringify({
        type: 'ready',
        version: MANAGED_BROWSER_STREAM_VERSION,
        frameEncoding: profile.frameEncoding,
        flowControl: 'frame-ack-v2',
        fallback: { maxRawBytes: profile.maxRawBytes },
        ownerId,
        media: {
          preferredRoute: clientWebRtc && this.#preferredMediaRoute === 'webrtc-preferred' ? 'webrtc-direct' : 'jpeg-fallback',
          stunOnly: true,
          negotiationTimeoutMs: this.#webrtcNegotiationTimeoutMs,
          retryCooldownMs: this.#webrtcRetryCooldownMs,
          frameRate: this.#directVideoFrameRate,
          maxBitrate: this.#directVideoMaxBitrate,
          idleTimeoutMs: this.#mediaIdleTimeoutMs,
          hideGraceMs: this.#mediaHideGraceMs,
        },
        layoutPolicy: this.#runtime.layoutPolicy(),
      }))
      const layout = currentLayout()
      if (layout === undefined) {
        socket.close(1011, 'Browser layout is not ready')
        return
      }
      sendProjection()
      if (layout.mode !== 'fit') await startCommittedMedia(layout)
    }
    let helloTimerActive = true
    const clearHelloTimer = (): void => {
      if (!helloTimerActive) return
      helloTimerActive = false
      clearTimeout(helloTimer)
      this.#timerCount -= 1
    }
    this.#timerCount += 1
    const helloTimer = setTimeout(() => {
      if (!helloTimerActive) return
      helloTimerActive = false
      this.#timerCount -= 1
      if (!handshaken) socket.close(1008, 'Browser stream hello timeout')
    }, this.#handshakeTimeoutMs)
    helloTimer.unref()
    // DSH Mobile's loopback bridge forwards client text messages as binary Buffers.
    socket.on('message', (data) => {
      if (currentTarget() === undefined) return
      const raw = data.toString()
      if (!handshaken) {
        const hello = decodeBrowserClientMessage(raw)
        if (hello?.type !== 'hello' || !hello.frameEncodings.includes(profile.frameEncoding)) {
          socket.close(1002, 'Invalid Browser stream hello')
          return
        }
        clientWebRtc = hello.media.webrtcVideo
        handshaken = true
        clearHelloTimer()
        this.#track(activate())
        return
      }
      const message = decodeBrowserClientMessage(raw)
      if (!activated) {
        if (message !== undefined && message.type !== 'hello') socket.close(1008, 'Previous Browser owner is still detaching')
        return
      }
      if (message?.type === 'frame-ack') {
        if (unacked !== undefined
          && message.sequence === unacked.sequence
          && message.revision === unacked.revision
          && message.mediaGeneration === unacked.mediaGeneration) {
          recordLatency(this.#diagnostics.fallbackAckEndToEndLatencyMs, this.#now() - unacked.sentAt)
          unacked = undefined
          this.#unackedCount -= 1
          pump()
        }
        return
      }
      if (message === undefined || message.type === 'hello') return
      if (message.type === 'surface-visibility') {
        const layout = currentLayout()
        if (mediaStarted && layout !== undefined && message.ownerId === ownerId && message.revision === layout.revision
          && message.mediaGeneration === layout.mediaGeneration) surfaceHidden = !message.visible
        return
      }
      if (message.type === 'rtc-answer' || message.type === 'rtc-candidate' || message.type === 'media-retry' || message.type === 'media-decline') {
        if (message.type === 'media-retry') {
          const layout = currentLayout()
          const now = this.#now()
          if (!mediaStarted || layout === undefined || message.ownerId !== ownerId || message.revision !== layout.revision
            || message.mediaGeneration !== layout.mediaGeneration
            || (mediaAttempt?.connected === true && message.trigger !== 'explicit')
            || now - Math.max(lastMediaFailureAt, lastMediaRetryAt) < this.#webrtcRetryCooldownMs) return
          lastMediaRetryAt = now
          replaceMediaAttempt(layout)
          return
        }
        if (message.type === 'media-decline') {
          const attempt = mediaAttempt
          if (attempt === undefined || message.ownerId !== ownerId || message.revision !== attempt.layout.revision
            || message.mediaGeneration !== attempt.layout.mediaGeneration) return
          this.#track(failMediaAttempt(attempt, 'client-' + message.reason))
          return
        }
        const attempt = mediaAttempt
        if (attempt === undefined || message.ownerId !== ownerId
          || message.revision !== attempt.layout.revision || message.mediaGeneration !== attempt.layout.mediaGeneration) return
        if (message.type === 'rtc-answer') {
          if (attempt.answerStarted) return
          attempt.answerStarted = true
          const task = attempt.encoder.acceptAnswer(message.description).then(async () => {
            if (mediaAttempt !== attempt) return
            attempt.answerAccepted = true
            const candidates = attempt.candidates.splice(0)
            for (const candidate of candidates) await attempt.encoder.addCandidate(candidate)
          }).catch(() => failMediaAttempt(attempt, 'answer-rejected'))
          this.#track(task)
          return
        }
        if (message.type === 'rtc-candidate') {
          if (attempt.inboundCandidateCount >= MANAGED_BROWSER_MAX_RTC_CANDIDATES) return
          attempt.inboundCandidateCount += 1
          if (!attempt.answerAccepted) {
            attempt.candidates.push(message.candidate)
            return
          }
          this.#track(attempt.encoder.addCandidate(message.candidate).catch(() => failMediaAttempt(attempt, 'candidate-rejected')))
          return
        }
      }
      void this.#onMessage(socket, tab, target.identity, cdp, message, requestFrame, commitLayout, currentLayout, noteMediaActivity, {
        get latest() { return latestProposalSequence },
        set latest(value: number) { latestProposalSequence = value },
      }).catch(() => { currentTarget() })
    })
    const activate = async (): Promise<void> => {
      await previousCleanup
      if (detached || this.#tabConnections.get(tabKey) !== connection || socket.readyState !== WebSocket.OPEN) return
      if (!activated) {
        activated = true
        releaseLease = this.#runtime.acquire(tab)
        this.#runtime.touch(tab)
      }
      if (!handshaken || startTask !== undefined) return
      startTask = start()
      await startTask
    }
    this.#socketCleanup.set(socket, connection.cleanup)
    socket.once('close', () => { this.#track(connection.cleanup()) })
    socket.once('error', () => { this.#track(connection.cleanup()) })
    this.#track(activate())
  }

  async #onMessage(
    socket: WebSocket,
    tab: ManagedTabKey,
    targetIdentity: ManagedBrowserTargetIdentity,
    cdp: ManagedCdpSession,
    message: Exclude<ReturnType<typeof decodeBrowserClientMessage>, undefined | { type: 'hello' } | { type: 'frame-ack' }>,
    requestFrame: (kind: 'activity' | 'passive') => void,
    commitLayout: (layout: BrowserLayout) => void,
    currentLayout: () => BrowserLayout | undefined,
    noteMediaActivity: () => void,
    proposal: { latest: number },
  ): Promise<void> {
    if (message.type === 'rtc-answer' || message.type === 'rtc-candidate' || message.type === 'media-retry' || message.type === 'media-decline') return
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
    if (message.type === 'layout-propose') {
      if (message.proposalSequence <= proposal.latest) return
      proposal.latest = message.proposalSequence
      this.#diagnostics.layoutProposals += 1
      const layout = await this.#runtime.proposeLayout(tab, { mode: message.mode, viewport: message.viewport }, targetIdentity)
      const current = currentLayout()
      if (current === undefined || current.revision !== layout.revision || current.mediaGeneration !== layout.mediaGeneration) return
      commitLayout(layout)
      return
    }
    if (message.type !== 'input') return
    const layout = currentLayout()
    if (layout === undefined || message.revision !== layout.revision) {
      this.#diagnostics.staleInputs += 1
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
        type: 'input-result', accepted: false, reason: 'stale-layout', revision: layout?.revision ?? 0,
      }))
      return
    }
    noteMediaActivity()
    this.#runtime.touch(tab)
    await dispatchBrowserInput(cdp, message.input)
    if (message.input.type === 'wheel') await waitForBrowserPaint(cdp)
    requestFrame('activity')
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

  #track(task: Promise<void>): void {
    this.#tasks.add(task)
    void task.finally(() => { this.#tasks.delete(task) })
  }

  async #reserveMediaCapacity(create: (order: number) => BrowserMediaCapacityOwner): Promise<BrowserMediaCapacityOwner | undefined> {
    const reservation = this.#mediaCapacityTransition.then(async () => {
      while (this.#peerCount >= this.#maxMediaPeers) {
        const candidates = [...this.#mediaCapacityOwners.values()]
          .map((owner) => ({ owner, priority: owner.evictionPriority() }))
          .filter((candidate): candidate is { owner: BrowserMediaCapacityOwner; priority: 0 | 1 } => candidate.priority !== undefined)
          .sort((left, right) => left.priority - right.priority || left.owner.order - right.owner.order)
        let evicted = false
        for (const candidate of candidates) {
          if (await candidate.owner.evict()) {
            evicted = true
            break
          }
        }
        if (!evicted) return undefined
      }
      const owner = create(++this.#mediaCapacityOrder)
      this.#mediaCapacityOwners.set(owner.ownerId, owner)
      this.#peerCount += 1
      return owner
    })
    this.#mediaCapacityTransition = reservation.then(() => undefined, () => undefined)
    return await reservation
  }

  #releaseMediaCapacity(owner: BrowserMediaCapacityOwner): void {
    if (this.#mediaCapacityOwners.get(owner.ownerId) !== owner) return
    this.#mediaCapacityOwners.delete(owner.ownerId)
    this.#peerCount -= 1
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

export type BrowserJpegCapture = { jpeg: Uint8Array; encodedSize: BrowserSize; quality: number; scale: number }

export type BrowserJpegCaptureObserver = {
  onCaptureAttempt?: (attemptIndex: number) => void
  onStaleDrop?: () => void
}

/** Capture only while the supplied committed layout remains current. */
export async function captureBrowserJpegForLayout(
  cdp: ManagedCdpSession,
  layout: BrowserLayout,
  currentLayout: () => BrowserLayout | undefined,
  profile: Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>,
  observer: BrowserJpegCaptureObserver = {},
): Promise<BrowserJpegCapture | undefined> {
  const capture = await captureBrowserJpegWithinBudget(cdp, layout.viewport, profile, observer)
  const current = currentLayout()
  if (capture === undefined) return undefined
  if (current?.revision === layout.revision && current.mediaGeneration === layout.mediaGeneration) return capture
  observer.onStaleDrop?.()
  return undefined
}

/** Capture the committed CSS viewport within one route's raw JPEG budget. */
export async function captureBrowserJpegWithinBudget(
  cdp: ManagedCdpSession,
  viewport: BrowserSize,
  profile: Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>,
  observer: Pick<BrowserJpegCaptureObserver, 'onCaptureAttempt'> = {},
): Promise<BrowserJpegCapture | undefined> {
  const metrics = await cdp.send('Page.getLayoutMetrics').catch(() => undefined)
  const origin = browserStreamVisualViewportOrigin(metrics)
  const preferredScale = browserStreamCaptureScale(viewport.width, viewport.height, profile.maxScale)
  const attempts = uniqueCaptureAttempts([
    { quality: profile.quality, scale: preferredScale },
    { quality: Math.min(profile.quality, 60), scale: Math.min(preferredScale, 1) },
    { quality: Math.min(profile.quality, 45), scale: Math.min(preferredScale, 0.75) },
    { quality: Math.min(profile.quality, 30), scale: Math.min(preferredScale, 0.5) },
  ])
  for (const [attemptIndex, attempt] of attempts.entries()) {
    observer.onCaptureAttempt?.(attemptIndex)
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: attempt.quality,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: origin.x,
        y: origin.y,
        width: viewport.width,
        height: viewport.height,
        scale: attempt.scale,
      },
    }).catch(() => undefined)
    const data = screenshotData(result)
    if (data === undefined) continue
    const jpeg = new Uint8Array(Buffer.from(data, 'base64'))
    if (jpeg.byteLength > profile.maxRawBytes) continue
    return {
      jpeg,
      encodedSize: {
        width: Math.max(1, Math.round(viewport.width * attempt.scale)),
        height: Math.max(1, Math.round(viewport.height * attempt.scale)),
      },
      quality: attempt.quality,
      scale: attempt.scale,
    }
  }
  return undefined
}

function uniqueCaptureAttempts(attempts: Array<{ quality: number; scale: number }>): Array<{ quality: number; scale: number }> {
  const seen = new Set<string>()
  return attempts.filter((attempt) => {
    const signature = attempt.quality + ':' + attempt.scale
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
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

function sameMediaLayout(left: BrowserLayout | undefined, right: BrowserLayout | undefined): boolean {
  return left !== undefined && right !== undefined
    && left.revision === right.revision && left.mediaGeneration === right.mediaGeneration
}

function positiveStreamInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('managedBrowser ' + name + ' must be a positive safe integer')
  return value
}

function nonNegativeStreamInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('managedBrowser ' + name + ' must be a non-negative safe integer')
  return value
}

function emptyLatencyDiagnostic(): ManagedBrowserLatencyDiagnostic {
  return { samples: 0, totalMs: 0, lastMs: 0, maxMs: 0 }
}

function recordLatency(metric: ManagedBrowserLatencyDiagnostic, elapsedMs: number): void {
  const sample = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  metric.samples = Math.min(Number.MAX_SAFE_INTEGER, metric.samples + 1)
  metric.totalMs = Math.min(Number.MAX_SAFE_INTEGER, metric.totalMs + sample)
  metric.lastMs = sample
  metric.maxMs = Math.max(metric.maxMs, sample)
}

function boundedStreamInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error('managedBrowser ' + name + ' must be an integer from ' + min + ' to ' + max)
  }
  return resolved
}

function jpegQuality(value: number | undefined, fallback: number, name: string): number {
  return boundedStreamInteger(value, fallback, 1, 100, name)
}

function jpegScale(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > 4) {
    throw new Error('managedBrowser ' + name + ' must be a finite number greater than 0 and at most 4')
  }
  return resolved
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

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end('HTTP/1.1 ' + status + ' ' + message + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  socket.destroy()
}

function rawByteBudget(value: number | undefined, fallback: number, name = 'JPEG raw-byte budget'): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('managedBrowser ' + name + ' must be a positive safe integer')
  return value
}
