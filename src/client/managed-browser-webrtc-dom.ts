import type { BrowserMediaReceiverPeer, BrowserMediaReceiverPeerEvents, BrowserMediaReceiverTrack } from '../managed-browser-webrtc-client.ts'
import type { BrowserRtcCandidate, BrowserRtcDescription } from '../managed-browser-webrtc.ts'

type PeerScope = { RTCPeerConnection?: unknown }

/** Report whether the current DOM can construct a receive-only WebRTC peer. */
export function browserWebRtcVideoAvailable(scope: PeerScope = globalThis): boolean {
  return typeof scope.RTCPeerConnection === 'function'
}

/** Create the receive-only browser peer used by the transport-neutral receiver. */
export function createBrowserDomPeer(events: BrowserMediaReceiverPeerEvents): BrowserMediaReceiverPeer {
  const peer = new RTCPeerConnection()
  peer.addTransceiver('video', { direction: 'recvonly' })
  peer.onicecandidate = (event) => { events.onCandidate(event.candidate?.toJSON() ?? null) }
  peer.onconnectionstatechange = () => { events.onConnectionState(peer.connectionState) }
  peer.ontrack = (event) => { events.onTrack(event.track) }
  return {
    async setRemoteDescription(description) { await peer.setRemoteDescription(description) },
    async createAnswer() { return description(await peer.createAnswer()) },
    async setLocalDescription(value) { await peer.setLocalDescription(value) },
    async addIceCandidate(candidate) { await peer.addIceCandidate(candidate) },
    close() { peer.close() },
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
