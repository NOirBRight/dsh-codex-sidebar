/** Browser-client WebRTC receiver state, independent of React and DOM presentation. */

import type { BrowserRtcCandidate, BrowserRtcDescription } from './managed-browser-webrtc.ts'

export type { BrowserRtcCandidate, BrowserRtcDescription } from './managed-browser-webrtc.ts'

export type BrowserMediaClientIdentity = {
  readonly ownerId: string
  readonly layoutRevision: number
  readonly mediaGeneration: number
}

export type BrowserMediaReceiverTrack = {
  readonly kind: string
  stop(): void
}

export type BrowserMediaReceiverPeerEvents = {
  onCandidate(candidate: BrowserRtcCandidate | null): void
  onConnectionState(state: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'): void
  onTrack(track: BrowserMediaReceiverTrack): void
}

/** The receiver never receives media-device access; it can only consume a remote video track. */
export type BrowserMediaReceiverPeer = {
  setRemoteDescription(description: BrowserRtcDescription): Promise<void>
  createAnswer(): Promise<BrowserRtcDescription>
  setLocalDescription(description: BrowserRtcDescription): Promise<void>
  addIceCandidate(candidate: BrowserRtcCandidate | null): Promise<void>
  close(): void
}

export type BrowserMediaRetryTrigger = 'explicit' | 'network-change' | 'tab-reactivate'
export type BrowserMediaFallbackReason = 'negotiation-timeout' | 'negotiation-error' | 'peer-failed' | 'host-fallback' | 'presentation-failed'

export type BrowserMediaReceiverEvent = BrowserMediaClientIdentity & {
  event:
    | { type: 'candidate'; candidate: BrowserRtcCandidate | null }
    | { type: 'video-track'; track: BrowserMediaReceiverTrack }
    | { type: 'route'; route: 'connecting' | 'webrtc-direct' | 'jpeg-fallback'; reason?: BrowserMediaFallbackReason }
    | { type: 'generation-ready'; track: BrowserMediaReceiverTrack }
    | { type: 'retry-request'; trigger: BrowserMediaRetryTrigger }
}

export type ManagedBrowserWebRtcReceiverOptions = {
  identity: BrowserMediaClientIdentity
  peerFactory: (events: BrowserMediaReceiverPeerEvents) => BrowserMediaReceiverPeer
  negotiationTimeoutMs: number
  retryCooldownMs: number
  onEvent?: (event: BrowserMediaReceiverEvent) => void
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
}

type ReceiverAttempt = {
  peer: BrowserMediaReceiverPeer
  timer: ReturnType<typeof setTimeout>
  pendingCandidates: Array<BrowserRtcCandidate | null>
  remoteReady: boolean
  connected: boolean
  frameReady: boolean
  ready: boolean
  disposed: boolean
  videoTrack?: BrowserMediaReceiverTrack
  abort: () => void
}

/** One authenticated owner/layout/media generation and its replaceable receive attempt. */
export class ManagedBrowserWebRtcReceiver {
  readonly identity: BrowserMediaClientIdentity
  #peerFactory: (events: BrowserMediaReceiverPeerEvents) => BrowserMediaReceiverPeer
  #negotiationTimeoutMs: number
  #retryCooldownMs: number
  #onEvent: (event: BrowserMediaReceiverEvent) => void
  #now: () => number
  #schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  #cancel: (timer: ReturnType<typeof setTimeout>) => void
  #current: ReceiverAttempt | undefined
  #nextRetryAt = 0
  #route: 'idle' | 'connecting' | 'webrtc-direct' | 'jpeg-fallback' = 'idle'
  #disposed = false

  constructor(opts: ManagedBrowserWebRtcReceiverOptions) {
    this.identity = Object.freeze({ ...opts.identity })
    this.#peerFactory = opts.peerFactory
    this.#negotiationTimeoutMs = positiveDuration(opts.negotiationTimeoutMs, 'negotiationTimeoutMs')
    this.#retryCooldownMs = nonnegativeDuration(opts.retryCooldownMs, 'retryCooldownMs')
    this.#onEvent = opts.onEvent ?? (() => {})
    this.#now = opts.now ?? Date.now
    this.#schedule = opts.schedule ?? setTimeout
    this.#cancel = opts.cancel ?? clearTimeout
  }

  /** Replace the current receive attempt and create an SDP answer for an exact current identity. */
  acceptOffer(identity: BrowserMediaClientIdentity, offer: BrowserRtcDescription): Promise<BrowserRtcDescription | undefined> {
    if (this.#disposed || !sameIdentity(this.identity, identity) || offer.type !== 'offer') return Promise.resolve(undefined)
    if (this.#current !== undefined) this.#disposeAttempt(this.#current)
    let attempt: ReceiverAttempt | undefined
    const peer = this.#peerFactory({
      onCandidate: (candidate) => {
        if (attempt === undefined || !this.#isCurrent(attempt)) return
        this.#emit({ type: 'candidate', candidate })
      },
      onConnectionState: (state) => {
        if (attempt === undefined || !this.#isCurrent(attempt)) return
        if (state === 'connected') {
          attempt.connected = true
          this.#publishReady(attempt)
          return
        }
        if (state === 'disconnected' || state === 'failed' || state === 'closed') this.#fallback(attempt, 'peer-failed')
      },
      onTrack: (track) => {
        if (attempt === undefined || !this.#isCurrent(attempt) || track.kind !== 'video') {
          track.stop()
          return
        }
        if (attempt.videoTrack !== undefined) {
          if (attempt.videoTrack !== track) track.stop()
          return
        }
        attempt.videoTrack = track
        attempt.frameReady = false
        attempt.ready = false
        this.#emit({ type: 'video-track', track })
      },
    })
    let abort = (): void => {}
    const aborted = new Promise<undefined>((resolve) => { abort = () => { resolve(undefined) } })
    attempt = {
      peer,
      timer: this.#schedule(() => {
        if (attempt !== undefined) this.#fallback(attempt, 'negotiation-timeout')
      }, this.#negotiationTimeoutMs),
      pendingCandidates: [],
      remoteReady: false,
      connected: false,
      frameReady: false,
      ready: false,
      disposed: false,
      abort,
    }
    this.#current = attempt
    this.#route = 'connecting'
    this.#emit({ type: 'route', route: 'connecting' })
    const negotiation = this.#negotiate(attempt, offer).catch(() => {
      if (this.#isCurrent(attempt)) this.#fallback(attempt, 'negotiation-error')
      return undefined
    })
    return Promise.race([negotiation, aborted])
  }

  /** Apply or queue one candidate only for the exact active identity. */
  async addCandidate(identity: BrowserMediaClientIdentity, candidate: BrowserRtcCandidate | null): Promise<boolean> {
    const attempt = this.#current
    if (this.#disposed || attempt === undefined || !sameIdentity(this.identity, identity)) return false
    if (!attempt.remoteReady) {
      attempt.pendingCandidates.push(candidate)
      return true
    }
    try {
      await attempt.peer.addIceCandidate(candidate)
      return this.#isCurrent(attempt)
    } catch {
      if (this.#isCurrent(attempt)) this.#fallback(attempt, 'negotiation-error')
      return false
    }
  }

  /** Confirm that the current video track has presented its first decoded frame. */
  markFrameReady(identity: BrowserMediaClientIdentity, track: BrowserMediaReceiverTrack): boolean {
    const attempt = this.#current
    if (this.#disposed || attempt === undefined || !sameIdentity(this.identity, identity) || attempt.videoTrack !== track) return false
    attempt.frameReady = true
    this.#publishReady(attempt)
    return true
  }

  /** Request a fresh Host offer after the fallback cooldown. */
  requestRetry(trigger: BrowserMediaRetryTrigger): boolean {
    const now = this.#now()
    if (this.#disposed || this.#route !== 'jpeg-fallback' || now < this.#nextRetryAt) return false
    this.#nextRetryAt = now + this.#retryCooldownMs
    this.#emit({ type: 'retry-request', trigger })
    return true
  }

  /** Release the current direct-video attempt and enter cooldown-backed JPEG fallback. */
  useFallback(reason: 'host-fallback' | 'presentation-failed'): boolean {
    if (this.#disposed || this.#route === 'jpeg-fallback') return false
    if (this.#current !== undefined) this.#disposeAttempt(this.#current)
    this.#route = 'jpeg-fallback'
    this.#nextRetryAt = this.#now() + this.#retryCooldownMs
    this.#emit({ type: 'route', route: 'jpeg-fallback', reason })
    return true
  }

  /** Close the exact current peer and track and cancel all future callbacks. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#route = 'idle'
    if (this.#current !== undefined) this.#disposeAttempt(this.#current)
  }

  async #negotiate(attempt: ReceiverAttempt, offer: BrowserRtcDescription): Promise<BrowserRtcDescription | undefined> {
    await attempt.peer.setRemoteDescription(offer)
    if (!this.#isCurrent(attempt)) return undefined
    attempt.remoteReady = true
    for (const candidate of attempt.pendingCandidates.splice(0)) {
      await attempt.peer.addIceCandidate(candidate)
      if (!this.#isCurrent(attempt)) return undefined
    }
    const answer = await attempt.peer.createAnswer()
    if (!this.#isCurrent(attempt) || answer.type !== 'answer') return undefined
    await attempt.peer.setLocalDescription(answer)
    return this.#isCurrent(attempt) ? answer : undefined
  }

  #publishReady(attempt: ReceiverAttempt): void {
    const track = attempt.videoTrack
    if (!this.#isCurrent(attempt) || attempt.ready || !attempt.connected || !attempt.frameReady || track === undefined) return
    attempt.ready = true
    this.#cancel(attempt.timer)
    this.#route = 'webrtc-direct'
    this.#emit({ type: 'route', route: 'webrtc-direct' })
    this.#emit({ type: 'generation-ready', track })
  }

  #fallback(attempt: ReceiverAttempt, reason: 'negotiation-timeout' | 'negotiation-error' | 'peer-failed'): void {
    if (!this.#isCurrent(attempt)) return
    this.#disposeAttempt(attempt)
    this.#route = 'jpeg-fallback'
    this.#nextRetryAt = this.#now() + this.#retryCooldownMs
    this.#emit({ type: 'route', route: 'jpeg-fallback', reason })
  }

  #disposeAttempt(attempt: ReceiverAttempt): void {
    if (attempt.disposed) return
    attempt.disposed = true
    if (this.#current === attempt) this.#current = undefined
    this.#cancel(attempt.timer)
    if (attempt.videoTrack !== undefined) attempt.videoTrack.stop()
    attempt.peer.close()
    attempt.abort()
  }

  #isCurrent(attempt: ReceiverAttempt): boolean {
    return !this.#disposed && !attempt.disposed && this.#current === attempt
  }

  #emit(event: BrowserMediaReceiverEvent['event']): void {
    if (!this.#disposed) this.#onEvent({ ...this.identity, event })
  }
}

function sameIdentity(left: BrowserMediaClientIdentity, right: BrowserMediaClientIdentity): boolean {
  return left.ownerId === right.ownerId
    && left.layoutRevision === right.layoutRevision
    && left.mediaGeneration === right.mediaGeneration
}

function positiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Managed Browser WebRTC ' + name + ' must be a positive integer')
  return value
}

function nonnegativeDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Managed Browser WebRTC ' + name + ' must be a non-negative integer')
  return value
}
