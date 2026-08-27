import { describe, expect, it, vi } from 'vitest'
import {
  ManagedBrowserWebRtcReceiver,
  type BrowserMediaClientIdentity,
  type BrowserMediaReceiverEvent,
  type BrowserMediaReceiverPeer,
  type BrowserMediaReceiverTrack,
  type BrowserRtcDescription,
} from '../src/managed-browser-webrtc-client.ts'

const IDENTITY: BrowserMediaClientIdentity = {
  ownerId: 'owner-1',
  layoutRevision: 4,
  mediaGeneration: 7,
}

class FakeTrack implements BrowserMediaReceiverTrack {
  stopCalls = 0

  constructor(readonly kind: string) {}

  stop(): void { this.stopCalls += 1 }
}

class FakePeer implements BrowserMediaReceiverPeer {
  readonly remoteDescriptions: BrowserRtcDescription[] = []
  readonly localDescriptions: BrowserRtcDescription[] = []
  readonly candidates: unknown[] = []
  closeCalls = 0
  remoteGate: Promise<void> | undefined
  events: Parameters<NonNullable<ConstructorParameters<typeof ManagedBrowserWebRtcReceiver>[0]['peerFactory']>>[0]

  constructor(events: FakePeer['events']) {
    this.events = events
  }

  async setRemoteDescription(description: BrowserRtcDescription): Promise<void> {
    this.remoteDescriptions.push(description)
    await this.remoteGate
  }

  async createAnswer(): Promise<BrowserRtcDescription> {
    return { type: 'answer', sdp: 'answer-sdp' }
  }

  async setLocalDescription(description: BrowserRtcDescription): Promise<void> {
    this.localDescriptions.push(description)
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    this.candidates.push(candidate)
  }

  close(): void { this.closeCalls += 1 }

  candidate(candidate: unknown): void { this.events.onCandidate(candidate as never) }
  connection(state: string): void { this.events.onConnectionState(state as never) }
  track(track: BrowserMediaReceiverTrack): void { this.events.onTrack(track) }
}

function harness(opts: { timeoutMs?: number; cooldownMs?: number; remoteGate?: Promise<void> } = {}): {
  receiver: ManagedBrowserWebRtcReceiver
  peers: FakePeer[]
  events: BrowserMediaReceiverEvent[]
} {
  const peers: FakePeer[] = []
  const events: BrowserMediaReceiverEvent[] = []
  return {
    receiver: new ManagedBrowserWebRtcReceiver({
      identity: IDENTITY,
      peerFactory: (callbacks) => {
        const peer = new FakePeer(callbacks)
        peer.remoteGate = opts.remoteGate
        peers.push(peer)
        return peer
      },
      negotiationTimeoutMs: opts.timeoutMs ?? 1_000,
      retryCooldownMs: opts.cooldownMs ?? 5_000,
      onEvent: (event) => { events.push(event) },
    }),
    peers,
    events,
  }
}

describe('managed Browser WebRTC receiver', () => {
  it('answers an offer and exchanges candidates through the injected peer', async () => {
    const { receiver, peers, events } = harness()
    const offer = { type: 'offer', sdp: 'offer-sdp' } as const

    await expect(receiver.acceptOffer(IDENTITY, offer)).resolves.toEqual({ type: 'answer', sdp: 'answer-sdp' })
    const peer = peers[0]
    expect(peer?.remoteDescriptions).toEqual([offer])
    expect(peer?.localDescriptions).toEqual([{ type: 'answer', sdp: 'answer-sdp' }])
    await expect(receiver.addCandidate(IDENTITY, { candidate: 'remote-candidate' })).resolves.toBe(true)
    expect(peer?.candidates).toEqual([{ candidate: 'remote-candidate' }])

    peer?.candidate({ candidate: 'local-candidate' })
    expect(events.at(-1)).toEqual({
      ...IDENTITY,
      event: { type: 'candidate', candidate: { candidate: 'local-candidate' } },
    })
  })

  it('stops non-video tracks and waits for the first current video frame before generation ready', async () => {
    const { receiver, peers, events } = harness()
    await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })
    const peer = peers[0]
    const audio = new FakeTrack('audio')
    const video = new FakeTrack('video')

    peer?.track(audio)
    expect(audio.stopCalls).toBe(1)
    expect(events.some((value) => value.event.type === 'video-track')).toBe(false)
    peer?.track(video)
    peer?.connection('connected')
    expect(events.some((value) => value.event.type === 'generation-ready')).toBe(false)
    expect(receiver.markFrameReady({ ...IDENTITY, mediaGeneration: 8 }, video)).toBe(false)
    expect(receiver.markFrameReady(IDENTITY, new FakeTrack('video'))).toBe(false)

    expect(receiver.markFrameReady(IDENTITY, video)).toBe(true)
    expect(events.slice(-2)).toEqual([
      { ...IDENTITY, event: { type: 'route', route: 'webrtc-direct' } },
      { ...IDENTITY, event: { type: 'generation-ready', track: video } },
    ])
    const eventCount = events.length
    expect(receiver.markFrameReady(IDENTITY, video)).toBe(true)
    expect(events).toHaveLength(eventCount)
  })

  it('falls back when negotiation cannot produce a ready video frame', async () => {
    vi.useFakeTimers()
    try {
      const { receiver, peers, events } = harness({ timeoutMs: 100 })
      await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })
      const video = new FakeTrack('video')
      peers[0]?.track(video)
      peers[0]?.connection('connected')

      await vi.advanceTimersByTimeAsync(100)

      expect(peers[0]?.closeCalls).toBe(1)
      expect(video.stopCalls).toBe(1)
      expect(events.at(-1)).toEqual({
        ...IDENTITY,
        event: { type: 'route', route: 'jpeg-fallback', reason: 'negotiation-timeout' },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('unblocks a hung offer at timeout and rate-limits every retry trigger', async () => {
    vi.useFakeTimers()
    try {
      let releaseRemote: (() => void) | undefined
      const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve })
      const { receiver, peers, events } = harness({ timeoutMs: 100, cooldownMs: 500, remoteGate })
      const pending = receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })

      await vi.advanceTimersByTimeAsync(100)
      await expect(pending).resolves.toBeUndefined()
      expect(receiver.requestRetry('explicit')).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(receiver.requestRetry('explicit')).toBe(true)
      expect(receiver.requestRetry('network-change')).toBe(false)
      await vi.advanceTimersByTimeAsync(500)
      expect(receiver.requestRetry('tab-reactivate')).toBe(true)
      expect(events.filter((value) => value.event.type === 'retry-request').map((value) => value.event)).toEqual([
        { type: 'retry-request', trigger: 'explicit' },
        { type: 'retry-request', trigger: 'tab-reactivate' },
      ])
      releaseRemote?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds candidates queued before the remote description is ready', async () => {
    let releaseRemote: (() => void) | undefined
    const remoteGate = new Promise<void>((resolve) => { releaseRemote = resolve })
    const { receiver, peers } = harness({ remoteGate })
    const pending = receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })

    for (let index = 0; index < 64; index += 1) {
      await expect(receiver.addCandidate(IDENTITY, { candidate: 'candidate:' + index })).resolves.toBe(true)
    }
    await expect(receiver.addCandidate(IDENTITY, { candidate: 'candidate:overflow' })).resolves.toBe(false)

    releaseRemote?.()
    await expect(pending).resolves.toEqual({ type: 'answer', sdp: 'answer-sdp' })
    expect(peers[0]?.candidates).toHaveLength(64)
    expect(peers[0]?.candidates.at(-1)).toEqual({ candidate: 'candidate:63' })
  })

  it('enters an explicit fallback by releasing the current peer and enables retry after cooldown', async () => {
    vi.useFakeTimers()
    try {
      const { receiver, peers, events } = harness({ cooldownMs: 500 })
      await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })
      const peer = peers[0]!
      const video = new FakeTrack('video')
      peer.track(video)
      peer.connection('connected')
      receiver.markFrameReady(IDENTITY, video)

      expect(receiver.useFallback('host-fallback')).toBe(true)
      expect(peer.closeCalls).toBe(1)
      expect(video.stopCalls).toBe(1)
      expect(events.at(-1)).toEqual({
        ...IDENTITY,
        event: { type: 'route', route: 'jpeg-fallback', reason: 'host-fallback' },
      })
      expect(receiver.requestRetry('explicit')).toBe(false)

      await vi.advanceTimersByTimeAsync(250)
      expect(receiver.useFallback('presentation-failed')).toBe(false)
      await vi.advanceTimersByTimeAsync(250)
      expect(receiver.requestRetry('explicit')).toBe(true)
      expect(peer.closeCalls).toBe(1)
      expect(video.stopCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores stale messages and stops tracks from replaced peers', async () => {
    const { receiver, peers, events } = harness()
    await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'first' })
    const first = peers[0]!
    await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'second' })
    const second = peers[1]!
    const staleTrack = new FakeTrack('video')
    const currentTrack = new FakeTrack('video')
    const eventCount = events.length

    first.candidate({ candidate: 'stale' })
    first.track(staleTrack)
    expect(staleTrack.stopCalls).toBe(1)
    expect(events).toHaveLength(eventCount)
    await expect(receiver.addCandidate({ ...IDENTITY, layoutRevision: 3 }, { candidate: 'wrong-layout' })).resolves.toBe(false)
    expect(second.candidates).toEqual([])
    second.track(currentTrack)
    expect(events.at(-1)).toEqual({ ...IDENTITY, event: { type: 'video-track', track: currentTrack } })
  })

  it('disposes its timer, peer, and current track exactly once', async () => {
    vi.useFakeTimers()
    try {
      const { receiver, peers, events } = harness({ timeoutMs: 100 })
      await receiver.acceptOffer(IDENTITY, { type: 'offer', sdp: 'offer' })
      const track = new FakeTrack('video')
      peers[0]?.track(track)
      receiver.dispose()
      receiver.dispose()
      peers[0]?.candidate({ candidate: 'late' })
      await vi.advanceTimersByTimeAsync(100)

      expect(peers[0]?.closeCalls).toBe(1)
      expect(track.stopCalls).toBe(1)
      expect(events.some((value) => value.event.type === 'candidate' && value.event.candidate?.candidate === 'late')).toBe(false)
      expect(events.some((value) => value.event.type === 'route' && value.event.route === 'jpeg-fallback')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
