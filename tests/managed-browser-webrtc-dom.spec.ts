import { describe, expect, it, vi } from 'vitest'
import { BrowserVideoPresentationSwitch, BrowserVideoSurface, browserWebRtcVideoAvailable, createBrowserDomPeer, handleBrowserVideoPresentation } from '../src/client/managed-browser-webrtc-dom.ts'

const PRESENTATION_IDENTITY = { ownerId: 'owner-dom', revision: 7, mediaGeneration: 11 } as const

class FakeVideo {
  hidden = false
  dataset: { dcsPresenter?: string } = {}
  muted = false
  autoplay = false
  playsInline = false
  #srcObject: unknown = null
  srcObjectError: Error | undefined
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  pauseCalls = 0
  playResult: Promise<void> = Promise.resolve()
  listeners = new Map<string, Set<() => void>>()
  frame: (() => void) | undefined

  get srcObject(): unknown { return this.#srcObject }
  set srcObject(value: unknown) {
    if (value !== null && this.srcObjectError !== undefined) throw this.srcObjectError
    this.#srcObject = value
  }
  play(): Promise<void> { return this.playResult }
  pause(): void { this.pauseCalls += 1 }
  addEventListener(type: string, listener: () => void): void { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type))!.add(listener) }
  removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener) }
  requestVideoFrameCallback(callback: () => void): number { this.frame = callback; return 1 }
  cancelVideoFrameCallback(): void { this.frame = undefined }
  emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener() }
}

describe('managed Browser WebRTC DOM adapter', () => {
  it('advertises WebRTC only when RTCPeerConnection is constructible', () => {
    expect(browserWebRtcVideoAvailable({})).toBe(false)
    expect(browserWebRtcVideoAvailable({ RTCPeerConnection: class {} })).toBe(true)
  })

  it('constructs a STUN-only receive peer with empty iceServers', () => {
    const constructed: unknown[] = []
    class FakePeer {
      connectionState = 'new'
      constructor(config?: unknown) { constructed.push(config) }
      addTransceiver(): void {}
      close(): void {}
    }
    const previous = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection
    try {
      createBrowserDomPeer({ onCandidate() {}, onConnectionState() {}, onTrack() {} })
      expect(constructed).toEqual([{ iceServers: [] }])
      constructed.length = 0
      createBrowserDomPeer({ onCandidate() {}, onConnectionState() {}, onTrack() {} }, ['stun:stun.example.test:3478'])
      expect(constructed).toEqual([{ iceServers: [{ urls: ['stun:stun.example.test:3478'] }] }])
    } finally {
      globalThis.RTCPeerConnection = previous
    }
  })

  it('retries peer construction without STUN when Chromium rejects the configured server list', () => {
    const constructed: unknown[] = []
    class FakePeer {
      connectionState = 'new'
      constructor(config?: unknown) {
        constructed.push(config)
        if (constructed.length === 1) throw new TypeError('invalid iceServers')
      }
      addTransceiver(): void {}
      close(): void {}
    }
    const previous = globalThis.RTCPeerConnection
    globalThis.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection
    try {
      createBrowserDomPeer({ onCandidate() {}, onConnectionState() {}, onTrack() {} }, ['stun:127.0.0.1:12345'])
      expect(constructed).toEqual([
        { iceServers: [{ urls: ['stun:127.0.0.1:12345'] }] },
        { iceServers: [] },
      ])
    } finally {
      globalThis.RTCPeerConnection = previous
    }
  })

  it('keeps video hidden until a decoded frame and releases it exactly once', async () => {
    const video = new FakeVideo()
    const track = { kind: 'video', stop: vi.fn() }
    const surface = new BrowserVideoSurface(video as never, (value) => ({ tracks: value }) as never, 1_000)
    const pending = surface.present(track)
    expect(video.muted).toBe(true)
    expect(video.autoplay).toBe(true)
    expect(video.playsInline).toBe(true)
    video.videoWidth = 1280
    video.videoHeight = 800
    video.frame?.()
    await expect(pending).resolves.toEqual({ width: 1280, height: 800 })
    surface.clear()
    surface.clear()
    expect(video.srcObject).toBeNull()
    expect(video.pauseCalls).toBe(1)
  })

  it('falls back on play rejection or first-frame timeout', async () => {
    const rejected = new FakeVideo()
    rejected.playResult = Promise.reject(new Error('blocked'))
    const rejectedSurface = new BrowserVideoSurface(rejected as never, () => ({}) as never, 100)
    await expect(rejectedSurface.present({ kind: 'video', stop() {} })).resolves.toBeUndefined()

    vi.useFakeTimers()
    try {
      const timed = new FakeVideo()
      const timedSurface = new BrowserVideoSurface(timed as never, () => ({}) as never, 100)
      const pending = timedSurface.present({ kind: 'video', stop() {} })
      await vi.advanceTimersByTimeAsync(100)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back when MediaStream creation or srcObject attachment rejects presentation', async () => {
    const track = { kind: 'video', stop() {} }
    const ready = vi.fn()
    const fallback = vi.fn()
    const createStreamFailure = new BrowserVideoSurface(new FakeVideo() as never, () => { throw new Error('MediaStream unavailable') })
    await handleBrowserVideoPresentation(createStreamFailure.present(track), () => true, ready, fallback)

    const attachmentFailure = new FakeVideo()
    attachmentFailure.srcObjectError = new Error('srcObject rejected')
    const attachSurface = new BrowserVideoSurface(attachmentFailure as never, () => ({}))
    await handleBrowserVideoPresentation(attachSurface.present(track), () => true, ready, fallback)

    expect(ready).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('ignores a rejected presentation after its media identity becomes stale', async () => {
    const ready = vi.fn()
    const fallback = vi.fn()
    await handleBrowserVideoPresentation(Promise.reject(new Error('stale present')), () => false, ready, fallback)
    expect(ready).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('keeps the last DOM video visible until a staged frame atomically replaces it', async () => {
    const firstVideo = new FakeVideo()
    const secondVideo = new FakeVideo()
    const canvas = { style: { opacity: '' } }
    const presentation = new BrowserVideoPresentationSwitch(
      [firstVideo as never, secondVideo as never],
      canvas,
      (tracks) => ({ tracks }),
    )
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual([undefined, undefined, '1'])
    expect([firstVideo.hidden, secondVideo.hidden]).toEqual([false, false])

    const first = presentation.stage(PRESENTATION_IDENTITY, 1_000)
    const firstReady = first.surface.present({ kind: 'video', stop() {} })
    firstVideo.videoWidth = 1280
    firstVideo.videoHeight = 800
    firstVideo.frame?.()
    await expect(firstReady).resolves.toEqual({ width: 1280, height: 800 })
    expect(firstVideo.dataset.dcsPresenter).toBeUndefined()
    expect(presentation.commit(first)).toBe(true)
    expect(presentation.snapshot()).toMatchObject({ presenter: 'video', identity: PRESENTATION_IDENTITY })
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual(['', undefined, '0'])
    expect([firstVideo.hidden, secondVideo.hidden]).toEqual([false, false])

    secondVideo.playResult = Promise.reject(new Error('new generation failed'))
    const failed = presentation.stage({ ...PRESENTATION_IDENTITY, mediaGeneration: 12 }, 1_000)
    await expect(failed.surface.present({ kind: 'video', stop() {} })).resolves.toBeUndefined()
    expect(presentation.discard(failed)).toBe(true)
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual(['', undefined, '0'])
    expect(firstVideo.pauseCalls).toBe(0)

    secondVideo.playResult = Promise.resolve()
    const nextIdentity = { ...PRESENTATION_IDENTITY, mediaGeneration: 13 }
    const next = presentation.stage(nextIdentity, 1_000)
    const nextReady = next.surface.present({ kind: 'video', stop() {} })
    secondVideo.videoWidth = 390
    secondVideo.videoHeight = 844
    secondVideo.frame?.()
    await expect(nextReady).resolves.toEqual({ width: 390, height: 844 })
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual(['', undefined, '0'])
    expect(presentation.commit(next)).toBe(true)
    expect(presentation.snapshot()).toMatchObject({ presenter: 'video', identity: nextIdentity })
    expect(presentation.commit(failed)).toBe(false)
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual([undefined, '', '0'])
    expect(firstVideo.pauseCalls).toBe(1)

    const pausesBeforeCanvas = secondVideo.pauseCalls
    presentation.showCanvas()
    expect([firstVideo.dataset.dcsPresenter, secondVideo.dataset.dcsPresenter, canvas.style.opacity]).toEqual([undefined, undefined, '1'])
    expect(secondVideo.pauseCalls).toBe(pausesBeforeCanvas + 1)
  })
})
