import type { BrowserMediaReceiverPeer, BrowserMediaReceiverPeerEvents, BrowserMediaReceiverTrack } from '../managed-browser-webrtc-client.ts'
import type { BrowserMediaIdentity } from '../managed-browser-protocol.ts'
import type { BrowserRtcCandidate, BrowserRtcDescription } from '../managed-browser-webrtc.ts'

type PeerScope = { RTCPeerConnection?: unknown }

/** Report whether the current DOM can construct a receive-only WebRTC peer. */
export function browserWebRtcVideoAvailable(scope: PeerScope = globalThis): boolean {
  return typeof scope.RTCPeerConnection === 'function'
}

/** Create the receive-only browser peer used by the transport-neutral receiver. */
export function createBrowserDomPeer(events: BrowserMediaReceiverPeerEvents, stunUrls: readonly string[] = []): BrowserMediaReceiverPeer {
  const configured = { iceServers: stunUrls.length === 0 ? [] : [{ urls: [...stunUrls] }] }
  const Peer = globalThis.RTCPeerConnection
  let peer: RTCPeerConnection
  try {
    peer = new Peer(configured)
  } catch (error) {
    if (stunUrls.length === 0) throw error
    peer = new Peer({ iceServers: [] })
  }
  peer.onicecandidate = (event) => { events.onCandidate(rtcCandidate(event.candidate?.toJSON() ?? null)) }
  peer.onconnectionstatechange = () => { events.onConnectionState(peer.connectionState) }
  peer.oniceconnectionstatechange = () => {
    const ice = peer.iceConnectionState
    if (ice === 'connected' || ice === 'completed') events.onConnectionState('connected')
    else if (ice === 'failed') events.onConnectionState('failed')
  }
  peer.ontrack = (event) => { events.onTrack(event.track) }
  return {
    async setRemoteDescription(description) { await peer.setRemoteDescription(description) },
    async createAnswer() { return description(await peer.createAnswer()) },
    async setLocalDescription(value) { await peer.setLocalDescription(value) },
    async addIceCandidate(candidate) { await peer.addIceCandidate(candidate) },
    close() { peer.close() },
  }
}

function rtcCandidate(candidate: RTCIceCandidateInit | null): BrowserRtcCandidate | null {
  if (candidate === null) return null
  return {
    candidate: candidate.candidate ?? '',
    ...(candidate.sdpMid === undefined ? {} : { sdpMid: candidate.sdpMid }),
    ...(candidate.sdpMLineIndex === undefined ? {} : { sdpMLineIndex: candidate.sdpMLineIndex }),
    ...(candidate.usernameFragment === undefined ? {} : { usernameFragment: candidate.usernameFragment }),
  }
}

type VideoLike = {
  muted: boolean
  autoplay: boolean
  playsInline: boolean
  srcObject: unknown
  readyState: number
  videoWidth: number
  videoHeight: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  requestVideoFrameCallback?(callback: () => void): number
  cancelVideoFrameCallback?(id: number): void
}

type PendingPresentation = {
  timer: ReturnType<typeof setTimeout>
  frameCallback?: number
  settle(value: { width: number; height: number } | undefined): void
  ready(): void
}

type PresentedVideoSize = { width: number; height: number }
type PresentationVideo = VideoLike & { dataset: { dcsPresenter?: string } }
type PresentationCanvas = { style: { opacity: string } }
type BrowserVideoStage = { readonly slot: 0 | 1; readonly identity: BrowserMediaIdentity; readonly surface: BrowserVideoSurface }

/** Exact DOM presenter currently visible on the managed Browser surface. */
export type BrowserVideoPresentationSnapshot =
  | { presenter: 'canvas' }
  | { presenter: 'video'; slot: 0 | 1; identity: BrowserMediaIdentity; intrinsicSize: PresentedVideoSize | null }

/** Settle every video presentation outcome only while its media identity remains current. */
export async function handleBrowserVideoPresentation(
  presentation: Promise<PresentedVideoSize | undefined>,
  isCurrent: () => boolean,
  onReady: (size: PresentedVideoSize) => void,
  onUnavailable: () => void,
): Promise<void> {
  let size: PresentedVideoSize | undefined
  try {
    size = await presentation
  } catch {
    size = undefined
  }
  if (!isCurrent()) return
  if (size === undefined) onUnavailable()
  else onReady(size)
}

/** Double-buffer video DOM attachment and preserve the last presented surface until commit. */
export class BrowserVideoPresentationSwitch {
  #videos: readonly [PresentationVideo, PresentationVideo]
  #canvas: PresentationCanvas
  #createStream: (tracks: BrowserMediaReceiverTrack[]) => unknown
  #active: BrowserVideoStage | undefined
  #pending: BrowserVideoStage | undefined

  constructor(
    videos: readonly [PresentationVideo, PresentationVideo],
    canvas: PresentationCanvas,
    createStream: (tracks: BrowserMediaReceiverTrack[]) => unknown = (tracks) => new MediaStream(tracks as MediaStreamTrack[]),
  ) {
    this.#videos = videos
    this.#canvas = canvas
    this.#createStream = createStream
    setVideoPresented(videos[0], false)
    setVideoPresented(videos[1], false)
    canvas.style.opacity = '1'
  }

  /** Attach an exact media identity to the hidden slot without changing the visible presentation. */
  stage(identity: BrowserMediaIdentity, timeoutMs: number): BrowserVideoStage {
    if (this.#pending !== undefined) this.discard(this.#pending)
    const slot: 0 | 1 = this.#active?.slot === 0 ? 1 : 0
    const surface = new BrowserVideoSurface(this.#videos[slot], this.#createStream, timeoutMs)
    const stage = { slot, identity: copyIdentity(identity), surface } as const
    setVideoPresented(this.#videos[slot], false)
    this.#pending = stage
    return stage
  }

  /** Reveal one ready stage and release the previous video only after the reveal. */
  commit(stage: BrowserVideoStage): boolean {
    if (this.#pending !== stage) return false
    const previous = this.#active
    setVideoPresented(this.#videos[stage.slot], true)
    this.#canvas.style.opacity = '0'
    this.#active = stage
    this.#pending = undefined
    if (previous !== undefined && previous !== stage) {
      setVideoPresented(this.#videos[previous.slot], false)
      previous.surface.clear()
    }
    return true
  }

  /** Drop only the matching staged attachment and leave the last presentation untouched. */
  discard(stage: BrowserVideoStage): boolean {
    if (this.#pending !== stage) return false
    this.#pending = undefined
    setVideoPresented(this.#videos[stage.slot], false)
    stage.surface.clear()
    return true
  }

  /** Drop the current staged attachment, if any. */
  discardPending(): void {
    if (this.#pending !== undefined) this.discard(this.#pending)
  }

  /** Report whether a stage can still commit without replacing a newer candidate. */
  canCommit(stage: BrowserVideoStage): boolean {
    return this.#pending === stage
  }

  /** Return the single DOM source currently revealed to the Browser surface. */
  snapshot(): BrowserVideoPresentationSnapshot {
    const active = this.#active
    if (active === undefined) return { presenter: 'canvas' }
    const video = this.#videos[active.slot]
    return {
      presenter: 'video',
      slot: active.slot,
      identity: copyIdentity(active.identity),
      intrinsicSize: video.videoWidth > 0 && video.videoHeight > 0
        ? { width: video.videoWidth, height: video.videoHeight }
        : null,
    }
  }

  /** Reveal an already-painted fallback canvas before releasing the previous video. */
  showCanvas(): void {
    this.#canvas.style.opacity = '1'
    const active = this.#active
    this.#active = undefined
    if (active !== undefined) {
      setVideoPresented(this.#videos[active.slot], false)
      active.surface.clear()
    }
  }

  /** Release both visible and staged video attachments. */
  clear(): void {
    this.discardPending()
    this.showCanvas()
  }
}

function setVideoPresented(video: PresentationVideo, presented: boolean): void {
  if (presented) video.dataset.dcsPresenter = ''
  else delete video.dataset.dcsPresenter
}

function copyIdentity(identity: BrowserMediaIdentity): BrowserMediaIdentity {
  return { ownerId: identity.ownerId, revision: identity.revision, mediaGeneration: identity.mediaGeneration }
}

/** Owns one video element attachment and resolves only after its first decoded frame. */
export class BrowserVideoSurface {
  #video: VideoLike
  #createStream: (tracks: BrowserMediaReceiverTrack[]) => unknown
  #timeoutMs: number
  #pending: PendingPresentation | undefined
  #attached = false

  constructor(video: VideoLike, createStream: (tracks: BrowserMediaReceiverTrack[]) => unknown = (tracks) => new MediaStream(tracks as MediaStreamTrack[]), timeoutMs = 5_000) {
    this.#video = video
    this.#createStream = createStream
    this.#timeoutMs = timeoutMs
  }

  async present(track: BrowserMediaReceiverTrack): Promise<PresentedVideoSize | undefined> {
    this.clear()
    const video = this.#video
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.srcObject = this.#createStream([track])
    this.#attached = true
    return new Promise((resolve) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(pending.timer)
        if (pending.frameCallback !== undefined) video.cancelVideoFrameCallback?.(pending.frameCallback)
        video.removeEventListener('loadeddata', ready)
        video.removeEventListener('playing', ready)
        if (this.#pending === pending) this.#pending = undefined
      }
      const settle = (value: { width: number; height: number } | undefined): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const ready = (): void => {
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) settle({ width: video.videoWidth, height: video.videoHeight })
      }
      const pending: PendingPresentation = { timer: setTimeout(() => { settle(undefined) }, this.#timeoutMs), settle, ready }
      this.#pending = pending
      video.addEventListener('loadeddata', ready)
      video.addEventListener('playing', ready)
      if (video.requestVideoFrameCallback !== undefined) {
        pending.frameCallback = video.requestVideoFrameCallback(() => {
          if (video.videoWidth > 0 && video.videoHeight > 0) settle({ width: video.videoWidth, height: video.videoHeight })
        })
      } else {
        ready()
      }
      void video.play().catch(() => { settle(undefined) })
    })
  }

  clear(): void {
    this.#pending?.settle(undefined)
    if (!this.#attached) return
    this.#attached = false
    this.#video.pause()
    this.#video.srcObject = null
  }
}

function description(value: RTCSessionDescriptionInit): BrowserRtcDescription {
  if ((value.type !== 'offer' && value.type !== 'answer') || typeof value.sdp !== 'string') throw new Error('Browser peer returned an invalid SDP description')
  return { type: value.type, sdp: value.sdp }
}
