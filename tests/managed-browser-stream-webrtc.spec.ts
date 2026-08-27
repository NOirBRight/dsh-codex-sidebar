import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { ManagedBrowserStream, type ManagedBrowserWebRtcEncoderLike } from '../src/managed-browser-stream.ts'
import type { BrowserLayout } from '../src/managed-browser-protocol.ts'
import type { ManagedBrowserWebRtcEncoderOptions } from '../src/managed-browser-webrtc.ts'

class FakeEncoder implements ManagedBrowserWebRtcEncoderLike {
  readonly options: ManagedBrowserWebRtcEncoderOptions
  answers: unknown[] = []
  candidates: unknown[] = []
  frames: number[] = []
  disposed = 0

  constructor(options: ManagedBrowserWebRtcEncoderOptions) { this.options = options }
  async start() { return { type: 'offer' as const, sdp: 'offer-' + this.options.identity.generation } }
  async acceptAnswer(value: unknown) { this.answers.push(value) }
  async addCandidate(value: unknown) { this.candidates.push(value) }
  submit(frame: { sequence: number }) { this.frames.push(frame.sequence); return true }
  async dispose() { this.disposed += 1 }
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
    expect(() => new ManagedBrowserStream({ runtime, webrtcNegotiationTimeoutMs: 0 })).toThrow('webrtcNegotiationTimeoutMs')
    expect(() => new ManagedBrowserStream({ runtime, webrtcRetryCooldownMs: -1 })).toThrow('webrtcRetryCooldownMs')
  })

  it('gates signaling by owner/layout and rotates one encoder per media generation', async () => {
    let layout: BrowserLayout = { revision: 1, mode: 'fit', viewport: { width: 720, height: 860 }, mediaGeneration: 1 }
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => method === 'Page.captureScreenshot'
      ? { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      : method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    const runtime = {
      target: () => ({ cdp, layout }), keyOf: () => 's:t', touch: () => {}, acquire: () => () => {},
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
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
      encoderFactory: (options) => { const encoder = new FakeEncoder(options); encoders.push(encoder); return encoder },
    })
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing stream port')
    const client = new WebSocket('ws://127.0.0.1:' + address.port + stream.issue({ sessionId: 's', tabId: 't' }).path)
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => {
          client.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: true } }))
          resolve()
        })
        client.once('error', reject)
      })
      await vi.waitFor(() => { expect(messages.some((value) => value.type === 'rtc-offer')).toBe(true) })
      const ready = messages.find((value) => value.type === 'ready') as { ownerId: string }
      const first = encoders[0]
      if (first === undefined) throw new Error('missing encoder')
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

      first.signal({ type: 'connection-state', state: 'connected' })
      await vi.waitFor(() => { expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'webrtc-direct' })) })
      const fallbackFrames = messages.filter((value) => value.type === 'frame').length
      cdp.emit('Page.screencastFrame', { data: 'dirty', sessionId: 1 })
      await vi.waitFor(() => { expect(first.frames.length).toBeGreaterThan(0) })
      expect(messages.filter((value) => value.type === 'frame')).toHaveLength(fallbackFrames)

      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'laptop', viewport: { width: 1280, height: 800 } }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(2); expect(first.disposed).toBe(1) })
      expect(messages.filter((value) => value.type === 'rtc-offer').at(-1)).toMatchObject({ revision: 2, mediaGeneration: 2 })
      client.send(JSON.stringify({ type: 'rtc-candidate', ...identity, candidate: null }))
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      expect(encoders[1]?.candidates).toEqual([])

      await vi.waitFor(() => {
        expect(encoders[1]?.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', route: 'jpeg-fallback', status: 'degraded', reason: 'negotiation-timeout' }))
      }, { timeout: 1_500 })
      client.send(JSON.stringify({ type: 'media-retry', ownerId: ready.ownerId, revision: 2, mediaGeneration: 2, trigger: 'network-change' }))
      await new Promise((resolve) => { setTimeout(resolve, 30) })
      expect(encoders).toHaveLength(2)
      await new Promise((resolve) => { setTimeout(resolve, 180) })
      client.send(JSON.stringify({ type: 'media-retry', ownerId: ready.ownerId, revision: 2, mediaGeneration: 2, trigger: 'network-change' }))
      await vi.waitFor(() => { expect(encoders).toHaveLength(3) })
      encoders[2]?.signal({ type: 'connection-state', state: 'failed' })
      await vi.waitFor(() => {
        expect(encoders[2]?.disposed).toBe(1)
        expect(messages).toContainEqual(expect.objectContaining({ type: 'media-route', reason: 'peer-failed' }))
      })
    } finally {
      client.close()
      await vi.waitFor(() => { expect(encoders.at(-1)?.disposed).toBe(1) })
      await stream.dispose()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    }
  })
})
