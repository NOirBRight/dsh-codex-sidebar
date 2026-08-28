import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { ManagedBrowserStream, type ManagedBrowserWebRtcEncoderLike } from '../src/managed-browser-stream.ts'
import type { BrowserLayout } from '../src/managed-browser-protocol.ts'
import type { ManagedBrowserWebRtcEncoderOptions } from '../src/managed-browser-webrtc.ts'
import { ManagedBrowserStreamHarness } from './support/managed-browser-stream-harness.ts'

type SocketSendData = Parameters<WebSocket['send']>[0]
type SocketSendOptions = Parameters<WebSocket['send']>[1]
type SocketSendCallback = NonNullable<Parameters<WebSocket['send']>[2]>
type TestTab = { sessionId: string; tabId: string }
type TestCdp = EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }

const TEST_TARGET_IDENTITIES = new WeakMap<TestCdp, object>()

function streamRuntimePorts(targetFor: (tab: TestTab) => { cdp: TestCdp; layout: BrowserLayout }) {
  const target = (tab: TestTab) => {
    const value = targetFor(tab)
    let identity = TEST_TARGET_IDENTITIES.get(value.cdp)
    if (identity === undefined) {
      identity = Object.freeze({})
      TEST_TARGET_IDENTITIES.set(value.cdp, identity)
    }
    return {
      ...value,
      identity,
      page: { viewportSize: () => value.layout.viewport },
      documentId: tab.tabId,
      layoutEpoch: value.layout.revision,
    }
  }
  return {
    target,
    ownedTarget: (tab: TestTab, expectedTarget: object) => {
      const current = target(tab)
      return current.identity === expectedTarget ? current : undefined
    },
    runInput: async (
      tab: TestTab,
      expectedTarget: object,
      expectedLayout: { revision: number; layoutEpoch: number },
      action: (cdp: TestCdp, targetIsCurrent: () => boolean) => Promise<void>,
    ) => {
      const current = target(tab)
      if (current.identity !== expectedTarget || current.layout.revision !== expectedLayout.revision
        || current.layoutEpoch !== expectedLayout.layoutEpoch) return false
      await action(current.cdp, () => target(tab).identity === expectedTarget)
      const after = target(tab)
      return after.identity === expectedTarget && after.layout.revision === expectedLayout.revision
        && after.layoutEpoch === expectedLayout.layoutEpoch
    },
  }
}

function deferFallbackFrameSendCallbacks(): {
  completions: Array<(error?: Error) => void>
  restore(): void
} {
  const original = WebSocket.prototype.send
  const completions: Array<(error?: Error) => void> = []
  const replacement = function (
    this: WebSocket,
    data: SocketSendData,
    optionsOrCallback?: SocketSendOptions | SocketSendCallback,
    callback?: SocketSendCallback,
  ): void {
    const completion = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
    let fallbackFrame = false
    if (typeof data === 'string') {
      try { fallbackFrame = (JSON.parse(data) as { type?: unknown }).type === 'frame' } catch { fallbackFrame = false }
    }
    if (!fallbackFrame || completion === undefined) {
      if (typeof optionsOrCallback === 'function') original.call(this, data, optionsOrCallback)
      else if (optionsOrCallback === undefined) original.call(this, data)
      else original.call(this, data, optionsOrCallback, callback)
      return
    }
    const delayed: SocketSendCallback = () => {
      completions.push((error) => { completion(error) })
    }
    if (typeof optionsOrCallback === 'function') original.call(this, data, delayed)
    else original.call(this, data, optionsOrCallback, delayed)
  }
  WebSocket.prototype.send = replacement as WebSocket['send']
  return {
    completions,
    restore() { WebSocket.prototype.send = original },
  }
}

class FakeEncoder implements ManagedBrowserWebRtcEncoderLike {
  readonly options: ManagedBrowserWebRtcEncoderOptions
  answers: unknown[] = []
  candidates: unknown[] = []
  frames: number[] = []
  disposed = 0
  disposeGate: Promise<void> | undefined

  constructor(options: ManagedBrowserWebRtcEncoderOptions) { this.options = options }
  async start() { return { type: 'offer' as const, sdp: 'offer-' + this.options.identity.generation } }
  async acceptAnswer(value: unknown) { this.answers.push(value) }
  async addCandidate(value: unknown) { this.candidates.push(value) }
  submit(frame: { sequence: number }) { this.frames.push(frame.sequence); return true }
  async dispose() { this.disposed += 1; await this.disposeGate }
  signal(signal: Parameters<NonNullable<ManagedBrowserWebRtcEncoderOptions['onSignal']>>[0]['signal']) {
    this.options.onSignal?.({ ...this.options.identity, signal })
  }
}

describe('ManagedBrowserStream WebRTC ownership', () => {
  it('rejects invalid media route, STUN and capacity configuration at construction', () => {
    const runtime = {} as never
    expect(() => new ManagedBrowserStream({ runtime, preferredMediaRoute: 'invalid' as never })).toThrow('preferredMediaRoute')
    expect(() => new ManagedBrowserStream({ runtime, stunUrls: ['turn:relay.example.test'] })).toThrow('STUN URLs only')
    expect(() => new ManagedBrowserStream({ runtime, maxMediaPeers: 0 })).toThrow('maxMediaPeers')
    expect(() => new ManagedBrowserStream({ runtime, maxMediaPeers: 2, maxEncoderPages: 1 })).toThrow('maxMediaPeers cannot exceed maxEncoderPages')
    expect(() => new ManagedBrowserStream({ runtime, webrtcNegotiationTimeoutMs: 0 })).toThrow('webrtcNegotiationTimeoutMs')
    expect(() => new ManagedBrowserStream({ runtime, webrtcRetryCooldownMs: -1 })).toThrow('webrtcRetryCooldownMs')
    expect(() => new ManagedBrowserStream({ runtime, directVideoFrameRate: 0 })).toThrow('directVideoFrameRate')
    expect(() => new ManagedBrowserStream({ runtime, directVideoMaxBitrate: 0 })).toThrow('directVideoMaxBitrate')
    expect(() => new ManagedBrowserStream({ runtime, directVideoCaptureQuality: 0 })).toThrow('directVideoCaptureQuality')
    expect(() => new ManagedBrowserStream({ runtime, directVideoCaptureMaxScale: 0 })).toThrow('directVideoCaptureMaxScale')
    expect(() => new ManagedBrowserStream({ runtime, directVideoCaptureMaxRawBytes: 0 })).toThrow('directVideoCaptureMaxRawBytes')
    expect(() => new ManagedBrowserStream({ runtime, mediaIdleTimeoutMs: 0 })).toThrow('mediaIdleTimeoutMs')
    expect(() => new ManagedBrowserStream({ runtime, mediaHideGraceMs: -1 })).toThrow('mediaHideGraceMs')
    expect(() => new ManagedBrowserStream({ runtime, shutdownTimeoutMs: 0 })).toThrow('shutdownTimeoutMs')
  })

  it('waits for the exact previous owner to detach before activating its replacement', async () => {
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    let releaseEncoder: (() => void) | undefined
    let releaseScreencast: (() => void) | undefined
    let releaseCapture: (() => void) | undefined
    const encoderGate = new Promise<void>((resolve) => { releaseEncoder = resolve })
    const screencastGate = new Promise<void>((resolve) => { releaseScreencast = resolve })
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve })
    let starts = 0
    let stops = 0
    let captures = 0
    let acquisitions = 0
    let releases = 0
    let proposals = 0
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => {
      if (method === 'Page.startScreencast') { starts += 1; return {} }
      if (method === 'Page.stopScreencast') { stops += 1; await screencastGate; return {} }
      if (method === 'Page.captureScreenshot') {
        captures += 1
        await captureGate
        return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      }
      if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 0, pageY: 0 } }
      return {}
    }
    const runtime = {
      ...streamRuntimePorts(() => ({ cdp, layout })), keyOf: () => 's:t', touch: () => {},
      acquire: () => { acquisitions += 1; return () => { releases += 1 } },
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async () => { proposals += 1; return layout }, outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      createMediaPage: async () => { throw new Error('factory must isolate the Page seam') }, mediaPageCount: () => 0,
    }
    const encoders: FakeEncoder[] = []
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const connect = async (): Promise<{ client: WebSocket; messages: Array<Record<string, unknown>> }> => {
      const client = await harness.connect({ sessionId: 's', tabId: 't' })
      const messages: Array<Record<string, unknown>> = []
      client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
      harness.hello(client, { webrtcVideo: true })
      return { client, messages }
    }
    const first = await connect()
    let second: Awaited<ReturnType<typeof connect>> | undefined
    let third: Awaited<ReturnType<typeof connect>> | undefined
    try {
      await vi.waitFor(() => {
        expect(encoders).toHaveLength(1)
        expect(starts).toBe(1)
        expect(captures).toBe(1)
        expect(acquisitions).toBe(1)
      })
      encoders[0]!.disposeGate = encoderGate

      second = await connect()
      await vi.waitFor(() => { expect(encoders[0]?.disposed).toBe(1); expect(stops).toBe(1) })
      expect(second.messages).toEqual([])
      expect(encoders).toHaveLength(1)
      expect(acquisitions).toBe(1)
      expect(releases).toBe(1)
      await vi.waitFor(() => { expect(stream.resources().timers).toBe(0) })

      const rejected = new Promise<{ code: number; reason: string }>((resolve) => {
        second?.client.once('close', (code, reason) => { resolve({ code, reason: reason.toString() }) })
      })
      second.client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'phone', viewport: { width: 390, height: 844 } }))
      await expect(rejected).resolves.toEqual({ code: 1008, reason: 'Previous Browser owner is still detaching' })
      expect(proposals).toBe(0)

      releaseEncoder?.()
      releaseScreencast?.()
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(second.messages).toEqual([])
      expect(encoders).toHaveLength(1)
      expect(acquisitions).toBe(1)

      releaseCapture?.()
      third = await connect()
      await vi.waitFor(() => {
        expect(third?.messages.some((message) => message.type === 'ready')).toBe(true)
        expect(encoders).toHaveLength(2)
        expect(starts).toBe(2)
        expect(acquisitions).toBe(2)
      })

      stream.closeTab({ sessionId: 's', tabId: 't' })
      await vi.waitFor(() => { expect(third?.client.readyState).toBe(WebSocket.CLOSED) })
    } finally {
      first.client.close()
      second?.client.close()
      third?.client.close()
      releaseEncoder?.()
      releaseScreencast?.()
      releaseCapture?.()
      await harness.dispose()
    }
  })

  it('keeps direct capture independent from an Origin-less Mobile fallback budget and reports route diagnostics', async () => {
    let layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    let now = 1_000
    let allowFallbackFrame = false
    const captures: Array<{ quality: number; scale: number }> = []
    const encoders: FakeEncoder[] = []
    const deferredSends = deferFallbackFrameSendCallbacks()
    const cdp = new EventEmitter() as EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
    cdp.send = async (method, params) => {
      if (method === 'Page.captureScreenshot') {
        const capture = params as { quality: number; clip: { scale: number } }
        captures.push({ quality: capture.quality, scale: capture.clip.scale })
        now += 5
        return { data: Buffer.alloc(allowFallbackFrame ? 90 * 1024 : 120 * 1024, 1).toString('base64') }
      }
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const runtime = {
      ...streamRuntimePorts(() => ({ cdp, layout })), keyOf: () => 'mobile:t', touch: () => {}, acquire: () => () => {},
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        layout = { revision: layout.revision + 1, mediaGeneration: layout.mediaGeneration + 1, ...proposal }
        return layout
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }), trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      createMediaPage: async () => { throw new Error('factory must isolate the Page seam') },
      mediaPageCount: () => encoders.filter((encoder) => encoder.disposed === 0).length,
    }
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      directVideoCaptureQuality: 88,
      directVideoCaptureMaxScale: 1.25,
      directVideoCaptureMaxRawBytes: 160 * 1024,
      webrtcNegotiationTimeoutMs: 1_000,
      now: () => now,
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'mobile', tabId: 't' })
    let fallbackFrames = 0
    client.on('message', (data) => {
      const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as {
        type?: string; sequence?: number; revision?: number; mediaGeneration?: number
      }
      if (message.type === 'frame') {
        fallbackFrames += 1
        now += 13
        client.send(JSON.stringify({
          type: 'frame-ack', sequence: message.sequence, revision: message.revision, mediaGeneration: message.mediaGeneration,
        }))
      }
    })
    try {
      harness.hello(client, { webrtcVideo: true })
      await vi.waitFor(() => {
        expect(encoders).toHaveLength(1)
        expect(stream.diagnostics()).toMatchObject({
          currentViewportRevision: 1,
          currentMediaGeneration: 1,
          fallbackBytes: 0,
          fallbackRecaptures: 3,
          encodedBytes: 0,
          routeBudgetDrops: 1,
          mediaAttempts: 1,
          activePeers: 1,
          activeEncoderPages: 1,
          activeSockets: 1,
          activeTimers: 1,
          activeCaptures: 0,
          captureLatencyMs: { samples: 1, lastMs: 20, maxMs: 20, totalMs: 20 },
        })
      })
      allowFallbackFrame = true
      now += 300
      cdp.emit('Page.screencastFrame', { data: 'dirty', sessionId: 1 })
      await vi.waitFor(() => {
        expect(fallbackFrames).toBe(1)
        expect(stream.diagnostics()).toMatchObject({
          fallbackBytes: 90 * 1024,
          encodedBytes: 90 * 1024,
          encodeLatencyMs: { samples: 1 },
          sendLatencyMs: { samples: 0 },
          fallbackAckEndToEndLatencyMs: { samples: 1, lastMs: 13 },
        })
      })
      await vi.waitFor(() => { expect(deferredSends.completions).toHaveLength(1) })
      now += 9
      deferredSends.completions.shift()?.()
      await vi.waitFor(() => {
        expect(stream.diagnostics()).toMatchObject({ sendLatencyMs: { samples: 1, lastMs: 22 } })
      })
      now += 300
      encoders[0]?.signal({ type: 'connection-state', state: 'connected' })
      await vi.waitFor(() => { expect(encoders[0]?.frames.length).toBeGreaterThan(0) })
      now += 7
      encoders[0]?.signal({
        type: 'frame-painted', sequence: encoders[0]?.frames.at(-1) ?? 0, width: 1280, height: 800,
      })
      await vi.waitFor(() => {
        expect(stream.diagnostics()).toMatchObject({ encoderPaintLatencyMs: { samples: 1, lastMs: 7 } })
      })
      expect(captures).toContainEqual({ quality: 88, scale: 1.25 })
      expect(captures.filter((capture) => capture.quality === 88)).toHaveLength(1)
      expect(JSON.stringify(stream.diagnostics())).not.toContain('example.test')

      client.send(JSON.stringify({ type: 'input', revision: 99, input: { type: 'tap', x: 10, y: 20 } }))
      now += 300
      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'laptop', viewport: { width: 1280, height: 800 } }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(2) })
      now += 300
      encoders[1]?.signal({ type: 'connection-state', state: 'failed' })
      await vi.waitFor(() => {
        expect(stream.diagnostics()).toMatchObject({
          layoutProposals: 1,
          layoutCommits: 1,
          staleInputs: 1,
          mediaAttempts: 2,
          mediaFailures: 1,
          lastMediaRoute: { route: 'jpeg-fallback', status: 'degraded', reason: 'peer-failed' },
          mediaRouteReasons: { 'peer-failed': 1 },
        })
      })
      expect(Object.keys(stream.resources()).sort()).toEqual(['captures', 'peers', 'sockets', 'timers', 'unackedFrames'])
      expect(stream.resources()).toMatchObject({ sockets: 1, captures: 0, unackedFrames: 0, peers: 0 })
      await vi.waitFor(() => {
        expect(fallbackFrames).toBeGreaterThanOrEqual(2)
        expect(deferredSends.completions).toHaveLength(1)
      })
      const failedCompletion = deferredSends.completions.shift()
      const sendSamples = stream.diagnostics().sendLatencyMs.samples
      failedCompletion?.(new Error('send failure'))
      await vi.waitFor(() => {
        expect(stream.resources()).toEqual({ sockets: 0, timers: 0, captures: 0, unackedFrames: 0, peers: 0 })
      })
      now += 17
      failedCompletion?.()
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(stream.diagnostics().sendLatencyMs.samples).toBe(sendSamples)
      expect(stream.resources()).toEqual({ sockets: 0, timers: 0, captures: 0, unackedFrames: 0, peers: 0 })
    } finally {
      await harness.dispose()
      deferredSends.restore()
    }
  })

  it('evicts a hidden active peer before a fallback peer but never evicts visible active peers', async () => {
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    const cdps = new Map<string, EventEmitter & { send(method: string): Promise<unknown> }>()
    const cdpFor = (tabId: string) => {
      let cdp = cdps.get(tabId)
      if (cdp !== undefined) return cdp
      cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
      cdp.send = async (method) => method === 'Page.captureScreenshot'
        ? { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
        : method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
      cdps.set(tabId, cdp)
      return cdp
    }
    const runtime = {
      ...streamRuntimePorts((tab) => ({ cdp: cdpFor(tab.tabId), layout })),
      keyOf: (tab: { sessionId: string; tabId: string }) => tab.sessionId + ':' + tab.tabId,
      touch: () => {}, acquire: () => () => {}, layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: (tab: { tabId: string }) => ({ tabId: tab.tabId, url: 'about:blank', title: '', documentId: tab.tabId, status: 'ready' }),
      proposeLayout: async () => layout, outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      createMediaPage: async () => { throw new Error('factory must isolate the Page seam') }, mediaPageCount: () => 0,
    }
    const encoders: FakeEncoder[] = []
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      maxMediaPeers: 2,
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const clients: WebSocket[] = []
    const connect = async (tabId: string): Promise<Array<Record<string, unknown>>> => {
      const messages: Array<Record<string, unknown>> = []
      const client = await harness.connect({ sessionId: 's', tabId })
      clients.push(client)
      client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
      harness.hello(client, { webrtcVideo: true })
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'rtc-offer' || message.type === 'media-route')).toBe(true) })
      return messages
    }
    const waitForControlBarrier = async (client: WebSocket, messages: Array<Record<string, unknown>>): Promise<void> => {
      const before = messages.filter((message) => message.type === 'input-result').length
      client.send(JSON.stringify({ type: 'input', revision: 999, input: { type: 'tap', x: 1, y: 1 } }))
      await vi.waitFor(() => {
        expect(messages.filter((message) => message.type === 'input-result')).toHaveLength(before + 1)
      })
    }
    try {
      const firstMessages = await connect('first')
      await vi.waitFor(() => { expect(encoders).toHaveLength(1) })
      const secondMessages = await connect('second')
      await vi.waitFor(() => { expect(encoders).toHaveLength(2) })
      expect(firstMessages.some((message) => message.type === 'rtc-offer')).toBe(true)
      expect(secondMessages.some((message) => message.type === 'rtc-offer')).toBe(true)
      const firstOffer = firstMessages.find((message) => message.type === 'rtc-offer')
      if (firstOffer === undefined) throw new Error('missing first offer')
      encoders[0]?.signal({ type: 'connection-state', state: 'connected' })
      await vi.waitFor(() => {
        expect(firstMessages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'webrtc-direct' }))
      })
      clients[0]?.send(JSON.stringify({
        type: 'surface-visibility', ownerId: firstOffer.ownerId, revision: firstOffer.revision,
        mediaGeneration: Number(firstOffer.mediaGeneration) + 1, visible: false,
      }))
      if (clients[0] === undefined) throw new Error('missing first client')
      await waitForControlBarrier(clients[0], firstMessages)

      const thirdMessages = await connect('third')
      await vi.waitFor(() => {
        expect(encoders).toHaveLength(3)
        expect(encoders[1]?.disposed).toBe(1)
        expect(secondMessages).toContainEqual(expect.objectContaining({
          type: 'media-route', route: 'jpeg-fallback', status: 'degraded', reason: 'local-capacity-evicted',
        }))
      })
      expect(encoders[0]?.disposed).toBe(0)
      expect(thirdMessages.some((message) => message.type === 'rtc-offer')).toBe(true)

      clients[0]?.send(JSON.stringify({
        type: 'surface-visibility', ownerId: firstOffer.ownerId, revision: firstOffer.revision,
        mediaGeneration: firstOffer.mediaGeneration, visible: false,
      }))
      await waitForControlBarrier(clients[0], firstMessages)
      const fourthMessages = await connect('fourth')
      await vi.waitFor(() => {
        expect(encoders).toHaveLength(4)
        expect(encoders[0]?.disposed).toBe(1)
        expect(firstMessages).toContainEqual(expect.objectContaining({
          type: 'media-route', route: 'jpeg-fallback', status: 'degraded', reason: 'local-capacity-evicted',
        }))
      })
      expect(encoders[2]?.disposed).toBe(0)
      expect(fourthMessages.some((message) => message.type === 'rtc-offer')).toBe(true)
      encoders[0]?.signal({ type: 'connection-state', state: 'connected' })
      expect(firstMessages.filter((message) => message.type === 'media-route' && message.route === 'webrtc-direct')).toHaveLength(1)

      encoders[2]?.signal({ type: 'connection-state', state: 'connected' })
      encoders[3]?.signal({ type: 'connection-state', state: 'connected' })
      const fifthMessages = await connect('fifth')
      await vi.waitFor(() => {
        expect(fifthMessages).toContainEqual(expect.objectContaining({
          type: 'media-route', route: 'jpeg-fallback', status: 'degraded', reason: 'local-capacity',
        }))
      })
      expect(encoders).toHaveLength(4)
      expect(encoders[2]?.disposed).toBe(0)
      expect(encoders[3]?.disposed).toBe(0)
      expect(stream.resources().peers).toBe(2)
    } finally {
      await harness.dispose()
    }
  })

  it('gates signaling by owner/layout and rotates one encoder per media generation', async () => {
    let layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => method === 'Page.captureScreenshot'
      ? { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      : method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    const runtime = {
      ...streamRuntimePorts(() => ({ cdp, layout })), keyOf: () => 's:t', touch: () => {}, acquire: () => () => {},
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        layout = { revision: layout.revision + 1, mediaGeneration: layout.mediaGeneration + 1, ...proposal }
        return layout
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }), trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      createMediaPage: async () => { throw new Error('factory must isolate the Page seam') }, mediaPageCount: () => 0,
    }
    const encoders: FakeEncoder[] = []
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      preferredMediaRoute: 'webrtc-preferred', stunUrls: ['stun:stun.example.test:3478'],
      webrtcNegotiationTimeoutMs: 500, webrtcRetryCooldownMs: 200, maxMediaPeers: 1,
      directVideoFrameRate: 12, directVideoMaxBitrate: 1_500_000,
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 's', tabId: 't' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client, { webrtcVideo: true })
      await vi.waitFor(() => { expect(messages.some((value) => value.type === 'rtc-offer')).toBe(true) })
      const ready = messages.find((value) => value.type === 'ready') as { ownerId: string }
      const first = encoders[0]
      if (first === undefined) throw new Error('missing encoder')
      expect(first.options).toMatchObject({ frameRate: 12, maxBitrate: 1_500_000 })
      const identity = { ownerId: ready.ownerId, revision: 1, mediaGeneration: 1 }
      for (let index = 0; index < 70; index += 1) {
        client.send(JSON.stringify({ type: 'rtc-candidate', ...identity, candidate: { candidate: 'candidate:queued-' + index } }))
      }
      client.send(JSON.stringify({ type: 'rtc-answer', ...identity, description: { type: 'answer', sdp: 'answer-1' } }))
      await vi.waitFor(() => { expect(first.answers).toHaveLength(1); expect(first.candidates).toHaveLength(64) })
      client.send(JSON.stringify({ type: 'rtc-candidate', ...identity, candidate: { candidate: 'candidate:overflow-after-answer' } }))
      client.send(JSON.stringify({ type: 'rtc-answer', ...identity, ownerId: 'stale-owner', description: { type: 'answer', sdp: 'bad' } }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(first.answers).toHaveLength(1)
      expect(first.candidates).toHaveLength(64)

      for (let index = 0; index < 63; index += 1) {
        first.signal({ type: 'candidate', candidate: { candidate: 'candidate:host-' + index } })
      }
      first.signal({ type: 'candidate', candidate: null })
      for (let index = 63; index < 70; index += 1) {
        first.signal({ type: 'candidate', candidate: { candidate: 'candidate:host-' + index } })
      }
      await vi.waitFor(() => {
        expect(messages.filter((value) => value.type === 'rtc-candidate')).toHaveLength(64)
      })
      expect(messages.filter((value) => value.type === 'rtc-candidate').at(-1)).toMatchObject({ candidate: null })

      first.signal({ type: 'connection-state', state: 'connected' })
      await vi.waitFor(() => { expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'webrtc-direct' })) })
      client.send(JSON.stringify({ type: 'media-decline', ...identity, ownerId: 'stale-owner', reason: 'presentation-failed' }))
      client.send(JSON.stringify({ type: 'media-decline', ...identity, revision: 99, reason: 'presentation-failed' }))
      client.send(JSON.stringify({ type: 'media-decline', ...identity, mediaGeneration: 99, reason: 'presentation-failed' }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(first.disposed).toBe(0)
      client.send(JSON.stringify({ type: 'media-decline', ...identity, reason: 'presentation-failed' }))
      await vi.waitFor(() => {
        expect(first.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'jpeg-fallback', reason: 'client-presentation-failed' }))
      })
      client.send(JSON.stringify({ type: 'media-retry', ...identity, trigger: 'explicit' }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(encoders).toHaveLength(1)
      await new Promise((resolve) => { setTimeout(resolve, 200) })
      client.send(JSON.stringify({ type: 'media-retry', ...identity, trigger: 'explicit' }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(2); expect(first.disposed).toBe(1) })
      const replacement = encoders[1]!
      replacement.signal({ type: 'connection-state', state: 'connected' })
      client.send(JSON.stringify({ type: 'media-retry', ...identity, trigger: 'network-change' }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(encoders).toHaveLength(2)
      await new Promise((resolve) => { setTimeout(resolve, 200) })
      client.send(JSON.stringify({ type: 'media-retry', ...identity, trigger: 'explicit' }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(3); expect(replacement.disposed).toBe(1) })
      const directReplacement = encoders[2]!
      directReplacement.signal({ type: 'connection-state', state: 'connected' })
      const fallbackFrames = messages.filter((value) => value.type === 'frame').length
      cdp.emit('Page.screencastFrame', { data: 'dirty', sessionId: 1 })
      await vi.waitFor(() => { expect(directReplacement.frames.length).toBeGreaterThan(0) })
      expect(messages.filter((value) => value.type === 'frame')).toHaveLength(fallbackFrames)

      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'laptop', viewport: { width: 1280, height: 800 } }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(4); expect(directReplacement.disposed).toBe(1) })
      expect(messages.filter((value) => value.type === 'rtc-offer').at(-1)).toMatchObject({ revision: 2, mediaGeneration: 2 })
      client.send(JSON.stringify({ type: 'rtc-candidate', ...identity, candidate: null }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(encoders[3]?.candidates).toEqual([])

      await vi.waitFor(() => {
        expect(encoders[3]?.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'jpeg-fallback', status: 'degraded', reason: 'negotiation-timeout' }))
      }, { timeout: 1_500 })
      client.send(JSON.stringify({ type: 'media-retry', ownerId: ready.ownerId, revision: 2, mediaGeneration: 2, trigger: 'network-change' }))
      await new Promise((resolve) => { setTimeout(resolve, 30) })
      expect(encoders).toHaveLength(4)
      await new Promise((resolve) => { setTimeout(resolve, 180) })
      client.send(JSON.stringify({ type: 'media-retry', ownerId: ready.ownerId, revision: 2, mediaGeneration: 2, trigger: 'network-change' }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(5) })
      encoders[4]?.signal({ type: 'connection-state', state: 'failed' })
      await vi.waitFor(() => {
        expect(encoders[4]?.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', reason: 'peer-failed' }))
      })
    } finally {
      client.close()
      await vi.waitFor(() => { expect(encoders.at(-1)?.disposed).toBe(1) })
      await harness.dispose()
    }
  })

  it('releases an inactive peer and lets later input retry after the cooldown', async () => {
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => method === 'Page.captureScreenshot'
      ? { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      : method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    const runtime = {
      ...streamRuntimePorts(() => ({ cdp, layout })), keyOf: () => 's:t', touch: () => {}, acquire: () => () => {},
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async () => layout, outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      createMediaPage: async () => { throw new Error('factory must isolate the Page seam') }, mediaPageCount: () => 0,
    }
    const encoders: FakeEncoder[] = []
    const stream = new ManagedBrowserStream({
      runtime: runtime as never, webrtcNegotiationTimeoutMs: 500, webrtcRetryCooldownMs: 20,
      mediaIdleTimeoutMs: 35,
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 's', tabId: 't' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client, { webrtcVideo: true })
      await vi.waitFor(() => { expect(encoders).toHaveLength(1) })
      encoders[0]?.signal({ type: 'connection-state', state: 'connected' })
      await vi.waitFor(() => {
        expect(encoders[0]?.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'jpeg-fallback', reason: 'media-idle-timeout' }))
      }, { timeout: 1_000 })

      await new Promise((resolve) => { setTimeout(resolve, 25) })
      client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 10, y: 20 } }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(2) })
    } finally {
      client.close()
      await vi.waitFor(() => { expect(encoders.at(-1)?.disposed).toBe(1) })
      await harness.dispose()
    }
  })
})
