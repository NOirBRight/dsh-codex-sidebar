import { describe, expect, it, vi } from 'vitest'
import { BrowserVideoSurface, browserWebRtcVideoAvailable } from '../src/client/managed-browser-webrtc-dom.ts'

class FakeVideo {
  muted = false
  autoplay = false
  playsInline = false
  srcObject: unknown = null
  readyState = 0
  videoWidth = 0
  videoHeight = 0
  pauseCalls = 0
  playResult: Promise<void> = Promise.resolve()
  listeners = new Map<string, Set<() => void>>()
  frame: (() => void) | undefined

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
})
