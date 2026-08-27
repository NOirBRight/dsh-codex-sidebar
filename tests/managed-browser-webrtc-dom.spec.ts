import { describe, expect, it, vi } from 'vitest'
import { BrowserVideoPresentationSwitch, BrowserVideoSurface, browserWebRtcVideoAvailable, handleBrowserVideoPresentation } from '../src/client/managed-browser-webrtc-dom.ts'

class FakeVideo {
  hidden = false
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
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([true, true, '1'])

    const first = presentation.stage(1_000)
    const firstReady = first.surface.present({ kind: 'video', stop() {} })
    firstVideo.videoWidth = 1280
    firstVideo.videoHeight = 800
    firstVideo.frame?.()
    await expect(firstReady).resolves.toEqual({ width: 1280, height: 800 })
    expect(firstVideo.hidden).toBe(true)
    expect(presentation.commit(first)).toBe(true)
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([false, true, '0'])

    secondVideo.playResult = Promise.reject(new Error('new generation failed'))
    const failed = presentation.stage(1_000)
    await expect(failed.surface.present({ kind: 'video', stop() {} })).resolves.toBeUndefined()
    expect(presentation.discard(failed)).toBe(true)
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([false, true, '0'])
    expect(firstVideo.pauseCalls).toBe(0)

    secondVideo.playResult = Promise.resolve()
    const next = presentation.stage(1_000)
    const nextReady = next.surface.present({ kind: 'video', stop() {} })
    secondVideo.videoWidth = 390
    secondVideo.videoHeight = 844
    secondVideo.frame?.()
    await expect(nextReady).resolves.toEqual({ width: 390, height: 844 })
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([false, true, '0'])
    expect(presentation.commit(next)).toBe(true)
    expect(presentation.commit(failed)).toBe(false)
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([true, false, '0'])
    expect(firstVideo.pauseCalls).toBe(1)

    const pausesBeforeCanvas = secondVideo.pauseCalls
    presentation.showCanvas()
    expect([firstVideo.hidden, secondVideo.hidden, canvas.style.opacity]).toEqual([true, true, '1'])
    expect(secondVideo.pauseCalls).toBe(pausesBeforeCanvas + 1)
  })
})
