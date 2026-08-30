import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  MANAGED_BROWSER_DEFAULT_STUN_URLS,
  MANAGED_BROWSER_DIRECT_VIDEO_FRAME_RATE,
  MANAGED_BROWSER_DIRECT_VIDEO_MAX_BITRATE,
  ManagedBrowserWebRtcEncoder,
  validateBrowserStunUrls,
  type BrowserMediaPage,
  type BrowserMediaSignal,
} from '../src/managed-browser-webrtc.ts'

class FakeMediaPage implements BrowserMediaPage {
  readonly commands: Array<Record<string, unknown>> = []
  readonly bootstrapArguments: unknown[] = []
  closed = false
  closeCalls = 0
  binding: ((source: unknown, payload: unknown) => void) | undefined
  paintGate: Promise<void> | undefined
  onCreateOffer: (() => void) | undefined

  async exposeBinding(_name: string, callback: (source: unknown, payload: unknown) => void): Promise<void> {
    this.binding = callback
  }

  async evaluateFunction<R>(_expression: string, argument: unknown): Promise<R> {
    if (isCommand(argument)) {
      if (argument.type === 'ice-state') return 'new' as R
      this.commands.push(argument)
      if (argument.type === 'create-offer') {
        this.onCreateOffer?.()
        return { type: 'offer', sdp: 'offer-sdp' } as R
      }
      if (argument.type === 'paint') await this.paintGate
      return undefined as R
    }
    this.bootstrapArguments.push(argument)
    return undefined as R
  }

  async close(): Promise<void> {
    this.closeCalls += 1
    this.closed = true
  }

  emit(payload: unknown, source: unknown = { page: this }): void {
    this.binding?.(source, payload)
  }
}

function isCommand(value: unknown): value is Record<string, unknown> & { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

describe('managed Browser WebRTC encoder', () => {
  it('accepts only STUN ICE URLs', () => {
    expect(validateBrowserStunUrls([])).toEqual([])
    expect(validateBrowserStunUrls(['stun:stun.example.test:3478'])).toEqual(['stun:stun.example.test:3478'])
    const encoderSource = readFileSync(new URL('../src/managed-browser-webrtc.ts', import.meta.url), 'utf8')
    expect(encoderSource).toContain('iceGatheringState')
    expect(encoderSource).toContain('oniceconnectionstatechange')
    expect(encoderSource).toContain("track.contentHint = 'detail'")
    expect(encoderSource).toContain("parameters.degradationPreference = 'maintain-resolution'")
    expect(encoderSource).not.toContain('setTimeout(resolve, Math.ceil(1000 / config.frameRate))')
    expect(MANAGED_BROWSER_DIRECT_VIDEO_FRAME_RATE).toBe(20)
    expect(MANAGED_BROWSER_DIRECT_VIDEO_MAX_BITRATE).toBe(8_000_000)
    expect(MANAGED_BROWSER_DEFAULT_STUN_URLS).toEqual(['stun:stun.l.google.com:19302'])
    expect(() => validateBrowserStunUrls(['turn:relay.example.test:3478'])).toThrow('STUN')
    expect(() => validateBrowserStunUrls(['https://stun.example.test'])).toThrow('STUN')
    expect(() => validateBrowserStunUrls(['stun:'])).toThrow('STUN')
  })

  it('boots one owned Page and exposes narrow offer, answer, and candidate commands', async () => {
    const page = new FakeMediaPage()
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner-1', generation: 7 },
      pageFactory: async () => page,
      stunUrls: ['stun:stun.example.test:3478'],
      width: 640,
      height: 480,
      frameRate: 12,
      maxBitrate: 1_500_000,
    })

    await expect(encoder.start()).resolves.toEqual({ type: 'offer', sdp: 'offer-sdp' })
    await encoder.acceptAnswer({ type: 'answer', sdp: 'answer-sdp' })
    await encoder.addCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 })

    expect(page.bootstrapArguments).toEqual([{
      iceServers: [{ urls: ['stun:stun.example.test:3478'] }],
      width: 640,
      height: 480,
      frameRate: 12,
      maxBitrate: 1_500_000,
    }])
    expect(page.commands).toEqual([
      { type: 'create-offer' },
      { type: 'accept-answer', description: { type: 'answer', sdp: 'answer-sdp' } },
      { type: 'add-candidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } },
    ])
  })

  it('does not trickle candidates already embedded while creating the offer', async () => {
    const page = new FakeMediaPage()
    const onSignal = vi.fn()
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner-1', generation: 1 }, pageFactory: async () => page,
      width: 640, height: 480, onSignal,
    })
    page.onCreateOffer = () => {
      page.emit({ type: 'candidate', candidate: { candidate: 'candidate:embedded' } })
      page.emit({ type: 'candidate', candidate: null })
    }
    await encoder.start()
    expect(onSignal).not.toHaveBeenCalled()
    page.emit({ type: 'candidate', candidate: { candidate: 'candidate:late' } })
    expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      signal: { type: 'candidate', candidate: { candidate: 'candidate:late' } },
    }))
  })

  it('rejects invalid direct-video encoder limits before creating a Page', () => {
    const pageFactory = vi.fn(async () => new FakeMediaPage())
    expect(() => new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner', generation: 1 }, pageFactory, width: 640, height: 480,
      frameRate: 0, maxBitrate: 2_000_000,
    })).toThrow('frameRate')
    expect(() => new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner', generation: 1 }, pageFactory, width: 640, height: 480,
      frameRate: 10, maxBitrate: 0,
    })).toThrow('maxBitrate')
    expect(pageFactory).not.toHaveBeenCalled()
  })

  it('replays only the latest queued frame after the peer connects', async () => {
    const page = new FakeMediaPage()
    const signals: BrowserMediaSignal[] = []
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner-1', generation: 3 },
      pageFactory: async () => page,
      width: 640,
      height: 480,
      onSignal: (signal) => { signals.push(signal) },
    })
    await encoder.start()

    encoder.submit({ sequence: 1, width: 640, height: 480, jpeg: new Uint8Array([1]) })
    encoder.submit({ sequence: 2, width: 320, height: 240, jpeg: new Uint8Array([2, 3]) })
    expect(page.commands.filter((command) => command.type === 'paint')).toEqual([])

    page.emit({ type: 'connection-state', state: 'connected' })
    await vi.waitFor(() => {
      expect(page.commands.filter((command) => command.type === 'paint')).toEqual([{
        type: 'paint',
        sequence: 2,
        width: 320,
        height: 240,
        jpegBase64: 'AgM=',
      }])
      expect(signals.some((signal) => signal.signal.type === 'frame-painted')).toBe(true)
    })
    expect(signals.find((signal) => signal.signal.type === 'frame-painted')).toEqual({
      ownerId: 'owner-1',
      generation: 3,
      signal: { type: 'frame-painted', sequence: 2, width: 320, height: 240 },
    })
  })

  it('allows one paint and retains only the latest dirty frame', async () => {
    const page = new FakeMediaPage()
    let releasePaint: (() => void) | undefined
    page.paintGate = new Promise<void>((resolve) => { releasePaint = resolve })
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner', generation: 1 },
      pageFactory: async () => page,
      width: 640,
      height: 480,
    })
    await encoder.start()
    page.emit({ type: 'connection-state', state: 'connected' })
    encoder.submit({ sequence: 1, width: 640, height: 480, jpeg: new Uint8Array([1]) })
    await vi.waitFor(() => { expect(page.commands.filter((command) => command.type === 'paint')).toHaveLength(1) })

    encoder.submit({ sequence: 2, width: 640, height: 480, jpeg: new Uint8Array([2]) })
    encoder.submit({ sequence: 3, width: 640, height: 480, jpeg: new Uint8Array([3]) })
    expect(page.commands.filter((command) => command.type === 'paint')).toHaveLength(1)

    releasePaint?.()
    await vi.waitFor(() => {
      expect(page.commands.filter((command) => command.type === 'paint')).toHaveLength(2)
    })
    expect(page.commands.filter((command) => command.type === 'paint').at(-1)).toMatchObject({ sequence: 3, jpegBase64: 'Aw==' })
  })

  it('drops stale Page callbacks and disposes exactly once', async () => {
    const page = new FakeMediaPage()
    const stalePage = new FakeMediaPage()
    const onSignal = vi.fn()
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'owner-2', generation: 9 },
      pageFactory: async () => page,
      width: 640,
      height: 480,
      onSignal,
    })
    await encoder.start()

    page.emit({ type: 'candidate', candidate: { candidate: 'stale' } }, { page: stalePage })
    expect(onSignal).not.toHaveBeenCalled()
    await Promise.all([encoder.dispose(), encoder.dispose()])
    page.emit({ type: 'candidate', candidate: { candidate: 'late' } })

    expect(onSignal).not.toHaveBeenCalled()
    expect(page.commands.at(-1)).toEqual({ type: 'dispose' })
    expect(page.closeCalls).toBe(1)
  })

  it('closes once when disposal wins a pending Page factory race', async () => {
    const page = new FakeMediaPage()
    let releasePage: ((page: FakeMediaPage) => void) | undefined
    const pendingPage = new Promise<FakeMediaPage>((resolve) => { releasePage = resolve })
    const encoder = new ManagedBrowserWebRtcEncoder({
      identity: { ownerId: 'racing-owner', generation: 1 },
      pageFactory: async () => pendingPage,
      width: 640,
      height: 480,
    })

    const starting = encoder.start()
    const disposing = encoder.dispose()
    releasePage?.(page)
    await expect(starting).rejects.toThrow('disposed')
    await disposing

    expect(page.closeCalls).toBe(1)
    expect(page.commands).toEqual([])
  })
})
