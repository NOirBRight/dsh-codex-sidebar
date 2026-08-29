import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { captureBrowserJpegForLayout, captureBrowserJpegWithinBudget, ManagedBrowserStream, MANAGED_BROWSER_MOBILE_MAX_RAW_BYTES, type BrowserStreamTransportProfile } from '../src/managed-browser-stream.ts'
import type { BrowserLayout } from '../src/managed-browser-protocol.ts'
import { ManagedBrowserStreamHarness } from './support/managed-browser-stream-harness.ts'

describe('managed Browser Host protocol v2', () => {
  it('keeps the default raw JPEG below the nested Mobile tunnel Base64 envelope', () => {
    const sidebarJsonBytes = Math.ceil(MANAGED_BROWSER_MOBILE_MAX_RAW_BYTES * 4 / 3) + 1024
    const tunnelPlaintextBytes = Math.ceil(sidebarJsonBytes * 4 / 3) + 1024
    expect(tunnelPlaintextBytes).toBeLessThan(200 * 1024)
  })

  it('waits for the first settled fit commit before starting media or publishing a frame', async () => {
    let layout: BrowserLayout = { revision: 1, mode: 'fit', viewport: { width: 720, height: 860 }, mediaGeneration: 1 }
    const calls: string[] = []
    let encoderStarts = 0
    let releaseScreencastStart!: () => void
    let signalScreencastStart!: () => void
    const screencastStart = new Promise<void>((resolve) => { signalScreencastStart = resolve })
    const screencastGate = new Promise<void>((resolve) => { releaseScreencastStart = resolve })
    let releaseVerification!: () => void
    let signalVerificationStarted!: () => void
    const verificationStarted = new Promise<void>((resolve) => { signalVerificationStarted = resolve })
    const verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve })
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => {
      calls.push(method)
      if (method === 'Page.startScreencast') {
        signalScreencastStart()
        await screencastGate
      }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const runtime = {
      target: () => ({ cdp, layout }), ownedTarget: () => ({ cdp, layout }), keyOf: () => 'fit:tab', touch: () => {}, acquire: () => () => {},
      runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => { await action(cdp, () => true); return true },
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => {
        signalVerificationStarted()
        await verificationGate
        return layout
      },
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        layout = { revision: 2, mode: proposal.mode, viewport: proposal.viewport, mediaGeneration: 2 }
        return layout
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }), trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
    }
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      preferredMediaRoute: 'webrtc-preferred',
      encoderFactory: () => ({
        start: async () => { encoderStarts += 1; return { type: 'offer', sdp: 'offer' } },
        acceptAnswer: async () => {}, addCandidate: async () => {}, submit: () => true, dispose: async () => {},
      }),
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'fit', tabId: 'tab' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client, { webrtcVideo: true })
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'ready')).toBe(true) })
      await new Promise((resolve) => { setTimeout(resolve, 25) })
      expect(messages.filter((message) => ['layout-commit', 'media-route', 'frame'].includes(String(message.type)))).toEqual([])
      expect(calls).not.toContain('Page.startScreencast')
      expect(calls).not.toContain('Page.captureScreenshot')
      expect(encoderStarts).toBe(0)
      expect(stream.resources().peers).toBe(0)

      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'fit', viewport: { width: 900, height: 600 } }))
      await screencastStart
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([])
      cdp.emit('Page.screencastFrame', { data: 'before-verification', sessionId: 1 })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(calls).not.toContain('Page.captureScreenshot')
      expect(encoderStarts).toBe(0)
      releaseScreencastStart()
      await verificationStarted
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([])
      cdp.emit('Page.screencastFrame', { data: 'during-verification', sessionId: 2 })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(calls).not.toContain('Page.captureScreenshot')
      expect(encoderStarts).toBe(0)
      releaseVerification()
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'frame')).toBe(true) })
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([
        expect.objectContaining({ layout: { revision: 2, mode: 'fit', viewport: { width: 900, height: 600 }, mediaGeneration: 2 } }),
      ])
      expect(messages.some((message) => message.type === 'media-route')).toBe(true)
      expect(calls.filter((method) => method === 'Page.startScreencast')).toHaveLength(1)
      expect(calls.filter((method) => method === 'Page.captureScreenshot')).toHaveLength(1)
      expect(encoderStarts).toBe(1)
      expect(stream.resources().peers).toBe(1)
    } finally {
      releaseScreencastStart()
      releaseVerification()
      await harness.dispose()
    }
  })

  it('does not publish a layout commit when post-start viewport verification fails', async () => {
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async () => ({})
    const runtime = {
      target: () => ({ cdp, layout }), ownedTarget: () => ({ cdp, layout }), keyOf: () => 'verify-failure:tab', touch: () => {}, acquire: () => () => {},
      layout: () => layout,
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => { throw new Error('post-start viewport mismatch') },
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only' })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'verify-failure', tabId: 'tab' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(client.readyState).toBe(WebSocket.CLOSED) })
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([])
    } finally {
      await harness.dispose()
    }
  })

  it('publishes only the single fixed preset proposed through the control connection', async () => {
    let layout: BrowserLayout = { revision: 1, mode: 'fit', viewport: { width: 720, height: 860 }, mediaGeneration: 1 }
    const proposals: Array<{ mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }> = []
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => {
      if (method === 'Page.captureScreenshot') return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const runtime = {
      target: () => ({ cdp, layout }), ownedTarget: () => ({ cdp, layout }), keyOf: () => 'preset:tab', touch: () => {}, acquire: () => () => {},
      runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => { await action(cdp, () => true); return true },
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      mediaPageCount: () => 0,
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        proposals.push(proposal)
        layout = { revision: 2, mode: proposal.mode, viewport: proposal.viewport, mediaGeneration: 2 }
        return layout
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }), trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only' })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'preset', tabId: 'tab' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'ready')).toBe(true) })
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(proposals).toEqual([])
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([])

      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'phone', viewport: { width: 390, height: 844 } }))
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'frame')).toBe(true) })
      expect(proposals).toEqual([{ mode: 'phone', viewport: { width: 390, height: 844 } }])
      expect(messages.filter((message) => message.type === 'layout-commit')).toEqual([
        expect.objectContaining({ layout: { revision: 2, mode: 'phone', viewport: { width: 390, height: 844 }, mediaGeneration: 2 } }),
      ])
      expect(stream.diagnostics()).toMatchObject({ layoutProposals: 1, layoutCommits: 1 })
    } finally {
      await harness.dispose()
    }
  })

  it('drops a screenshot across a document or viewport epoch and keeps the control socket alive while resize blocks media and input', async () => {
    const identity = Object.freeze({ target: 'transition' })
    let layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    let layoutEpoch = 1
    let documentId = 'd1'
    let transitioning = false
    const captureGates: Array<{ signalStarted: () => void; blocked: Promise<void> }> = []
    const blockNextCapture = (): { started: Promise<void>; release: () => void } => {
      let signalStarted!: () => void
      let release!: () => void
      const started = new Promise<void>((resolve) => { signalStarted = resolve })
      const blocked = new Promise<void>((resolve) => { release = resolve })
      captureGates.push({ signalStarted, blocked })
      return { started, release }
    }
    let releaseProposal!: () => void
    let markProposalStarted!: () => void
    const proposalStarted = new Promise<void>((resolve) => { markProposalStarted = resolve })
    let captureCalls = 0
    const inputCalls: string[] = []
    const cdp = new EventEmitter() as EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
    cdp.send = async (method, params) => {
      if (method === 'Page.captureScreenshot') {
        captureCalls += 1
        const gate = captureGates.shift()
        if (gate !== undefined) {
          gate.signalStarted()
          await gate.blocked
        }
        return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      }
      if (method === 'Input.dispatchMouseEvent') inputCalls.push(String(params?.type))
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const exactTarget = () => ({ identity, cdp, documentId, layout, layoutEpoch })
    const runtime = {
      target: (_tab: unknown, expected?: object) => !transitioning && (expected === undefined || expected === identity) ? exactTarget() : undefined,
      ownedTarget: (_tab: unknown, expected?: object) => expected === identity ? exactTarget() : undefined,
      keyOf: () => 'transition:tab', touch: () => {}, acquire: () => () => {},
      layout: () => layout,
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      mediaPageCount: () => 0,
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId, status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        transitioning = true
        layoutEpoch += 1
        markProposalStarted()
        await new Promise<void>((resolve) => { releaseProposal = resolve })
        layout = { revision: 2, mode: proposal.mode, viewport: proposal.viewport, mediaGeneration: 2 }
        transitioning = false
        return layout
      },
      runInput: async (_tab: unknown, expected: object, expectedLayout: { revision: number; layoutEpoch: number }, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => {
        if (transitioning || expected !== identity || expectedLayout.layoutEpoch !== layoutEpoch || expectedLayout.revision !== layout.revision) return false
        await action(cdp, () => !transitioning && expected === identity)
        return !transitioning && expectedLayout.layoutEpoch === layoutEpoch
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only', mobileJpegFrameIntervalMs: 1 })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'transition', tabId: 'tab' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(messages.filter(({ type }) => type === 'frame')).toHaveLength(1) })
      const first = messages.find(({ type }) => type === 'frame') as { sequence: number; revision: number; mediaGeneration: number }
      client.send(JSON.stringify({ type: 'frame-ack', sequence: first.sequence, revision: first.revision, mediaGeneration: first.mediaGeneration }))
      await vi.waitFor(() => { expect(stream.resources().unackedFrames).toBe(0) })

      const documentCapture = blockNextCapture()
      client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 1, y: 1 } }))
      await documentCapture.started
      documentId = 'd2'
      documentCapture.release()
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(messages.filter(({ type }) => type === 'frame')).toHaveLength(1)

      const epochCapture = blockNextCapture()
      client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 1, y: 1 } }))
      await epochCapture.started
      transitioning = true
      layoutEpoch += 1
      transitioning = false
      epochCapture.release()
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(messages.filter(({ type }) => type === 'frame')).toHaveLength(1)

      inputCalls.length = 0
      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'phone', viewport: { width: 390, height: 844 } }))
      await proposalStarted
      const capturesBeforeTransitionEvent = captureCalls
      cdp.emit('Page.screencastFrame', { data: 'during-transition', sessionId: 3 })
      client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 2, y: 2 } }))
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      expect(client.readyState).toBe(WebSocket.OPEN)
      expect(captureCalls).toBe(capturesBeforeTransitionEvent)
      expect(inputCalls).toEqual([])

      releaseProposal()
      await vi.waitFor(() => { expect(messages.some(({ type, layout: committed }) => type === 'layout-commit' && (committed as BrowserLayout).revision === 2)).toBe(true) })
      await vi.waitFor(() => { expect(messages.filter(({ type }) => type === 'frame')).toHaveLength(2) })
      expect(messages.filter(({ type }) => type === 'frame')[1]).toMatchObject({ revision: 2, mediaGeneration: 2, viewport: { width: 390, height: 844 } })
    } finally {
      for (const gate of captureGates) gate.signalStarted()
      releaseProposal?.()
      await harness.dispose()
    }
  })

  it('rejects every old socket operation after the same Tab receives a replacement target', async () => {
    for (const trigger of ['capture', 'proposal', 'input'] as const) {
      const firstIdentity = Object.freeze({ target: 'first' })
      const secondIdentity = Object.freeze({ target: 'second' })
      const firstCalls: string[] = []
      const firstCdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
      firstCdp.send = async (method) => {
        firstCalls.push(method)
        if (method === 'Page.captureScreenshot') return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
        return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
      }
      const secondCdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
      secondCdp.send = async () => ({})
      let current = {
        identity: firstIdentity,
        cdp: firstCdp,
        layout: { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 } satisfies BrowserLayout,
      }
      const proposals: BrowserLayout['mode'][] = []
      const runtime = {
        target: () => current,
        ownedTarget: () => current,
        runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof firstCdp, current: () => boolean) => Promise<void>) => { await action(current.cdp, () => true); return true },
        keyOf: () => 'replacement:tab', touch: () => {}, acquire: () => () => {},
        layout: () => ({ ...current.layout, viewport: { ...current.layout.viewport } }),
        layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
        verifyLayout: async () => current.layout,
        mediaPageCount: () => 0,
        projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
        proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
          proposals.push(proposal.mode)
          current.layout = {
            revision: current.layout.revision + 1,
            mode: proposal.mode,
            viewport: proposal.viewport,
            mediaGeneration: current.layout.mediaGeneration + 1,
          }
          return current.layout
        },
        outline: async () => ({ documentId: 'd1', nodes: [] }),
        trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      }
      const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only' })
      const harness = await ManagedBrowserStreamHarness.start(stream)
      const client = await harness.connect({ sessionId: 'replacement', tabId: 'tab' })
      const messages: Array<Record<string, unknown>> = []
      let closeCode: number | undefined
      client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
      client.on('close', (code) => { closeCode = code })
      try {
        harness.hello(client)
        await vi.waitFor(() => { expect(messages.some((message) => message.type === 'frame')).toBe(true) })
        const frame = messages.find((message) => message.type === 'frame') as { sequence: number; revision: number; mediaGeneration: number }
        client.send(JSON.stringify({ type: 'frame-ack', sequence: frame.sequence, revision: frame.revision, mediaGeneration: frame.mediaGeneration }))
        await vi.waitFor(() => { expect(stream.resources().unackedFrames).toBe(0) })
        firstCalls.length = 0

        current = {
          identity: secondIdentity,
          cdp: secondCdp,
          layout: { revision: 1, mode: 'fit', viewport: { width: 720, height: 860 }, mediaGeneration: 1 },
        }
        if (trigger === 'capture') firstCdp.emit('Page.screencastFrame', { data: 'stale', sessionId: 99 })
        if (trigger === 'proposal') client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'phone', viewport: { width: 390, height: 844 } }))
        if (trigger === 'input') client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 10, y: 20 } }))

        await vi.waitFor(() => { expect(client.readyState).toBe(WebSocket.CLOSED) })
        expect(closeCode).toBe(4002)
        expect(proposals).toEqual([])
        expect(firstCalls).not.toContain('Page.captureScreenshot')
        expect(firstCalls.some((method) => method.startsWith('Input.'))).toBe(false)
      } finally {
        await harness.dispose()
      }
    }
  })

  it('closes an idle control connection when its exact target is invalidated', async () => {
    const identity = Object.freeze({ target: 'idle' })
    const layout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 } satisfies BrowserLayout
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => method === 'Page.getLayoutMetrics'
      ? { visualViewport: { pageX: 0, pageY: 0 } }
      : method === 'Page.captureScreenshot'
        ? { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
        : {}
    const tab = { sessionId: 'idle-replacement', tabId: 'tab' }
    const runtime = {
      target: () => ({ identity, cdp, layout }), ownedTarget: () => ({ identity, cdp, layout }), keyOf: () => 'idle-replacement:tab', touch: () => {}, acquire: () => () => {},
      runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => { await action(cdp, () => true); return true },
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      mediaPageCount: () => 0,
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only' })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect(tab)
    let closeCode: number | undefined
    client.on('close', (code) => { closeCode = code })
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(stream.resources().sockets).toBe(1) })

      stream.invalidateTarget(tab, identity as never)

      await vi.waitFor(() => { expect(client.readyState).toBe(WebSocket.CLOSED) })
      expect(closeCode).toBe(4002)
      expect(stream.resources().sockets).toBe(0)
    } finally {
      await harness.dispose()
    }
  })

  it('stops an in-flight wheel at the exact target replacement before paint or selector tracking', async () => {
    const firstIdentity = Object.freeze({ target: 'first' })
    const secondIdentity = Object.freeze({ target: 'second' })
    let releaseWheel!: () => void
    let wheelStarted!: () => void
    const wheelGate = new Promise<void>((resolve) => { releaseWheel = resolve })
    const wheelDispatched = new Promise<void>((resolve) => { wheelStarted = resolve })
    const firstCalls: string[] = []
    const firstCdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    firstCdp.send = async (method) => {
      firstCalls.push(method)
      if (method === 'Input.dispatchMouseEvent') {
        wheelStarted()
        await wheelGate
      }
      if (method === 'Page.captureScreenshot') return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const secondCalls: string[] = []
    const secondCdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    secondCdp.send = async (method) => { secondCalls.push(method); return {} }
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    let current = { identity: firstIdentity, cdp: firstCdp, layout }
    let trackRectCalls = 0
    const runtime = {
      target: (_tab: unknown, expected?: object) => expected === undefined || expected === current.identity ? current : undefined,
      ownedTarget: (_tab: unknown, expected?: object) => expected === undefined || expected === current.identity ? current : undefined,
      runInput: async (_tab: unknown, expected: object, _layout: unknown, action: (session: typeof firstCdp, current: () => boolean) => Promise<void>) => {
        if (expected !== current.identity) return false
        await action(current.cdp, () => expected === current.identity)
        return expected === current.identity
      },
      keyOf: () => 'wheel-replacement:tab', touch: () => {}, acquire: () => () => {},
      layout: () => layout,
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      mediaPageCount: () => 0,
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => { trackRectCalls += 1; return { documentId: 'd1', selector: '#target', rect: null } },
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, preferredMediaRoute: 'jpeg-only' })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'wheel-replacement', tabId: 'tab' })
    const messages: Array<Record<string, unknown>> = []
    let closeCode: number | undefined
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    client.on('close', (code) => { closeCode = code })
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'frame')).toBe(true) })
      const frame = messages.find((message) => message.type === 'frame') as { sequence: number; revision: number; mediaGeneration: number }
      client.send(JSON.stringify({ type: 'frame-ack', sequence: frame.sequence, revision: frame.revision, mediaGeneration: frame.mediaGeneration }))
      await vi.waitFor(() => { expect(stream.resources().unackedFrames).toBe(0) })
      firstCalls.length = 0

      client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'wheel', x: 10, y: 20, deltaX: 0, deltaY: 100, selector: '#target' } }))
      await wheelDispatched
      current = { identity: secondIdentity, cdp: secondCdp, layout }
      releaseWheel()

      await vi.waitFor(() => { expect(client.readyState).toBe(WebSocket.CLOSED) })
      expect(closeCode).toBe(4002)
      expect(firstCalls.filter((method) => method !== 'Page.stopScreencast')).toEqual(['Input.dispatchMouseEvent'])
      expect(secondCalls).toEqual([])
      expect(trackRectCalls).toBe(0)
    } finally {
      releaseWheel()
      await harness.dispose()
    }
  })

  it('hard-limits twenty acknowledged interactions and bounds later passive animation', async () => {
    const captureTimes: number[] = []
    const cdp = new EventEmitter() as EventEmitter & { send(method: string): Promise<unknown> }
    cdp.send = async (method) => {
      if (method === 'Page.captureScreenshot') {
        captureTimes.push(Date.now())
        return { data: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64') }
      }
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const layout: BrowserLayout = { revision: 1, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 1 }
    const runtime = {
      target: () => ({ cdp, layout }), ownedTarget: () => ({ cdp, layout }), keyOf: () => 'animation:tab', touch: () => {}, acquire: () => () => {},
      runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => { await action(cdp, () => true); return true },
      layout: () => layout,
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => layout,
      projection: () => ({ tabId: 'tab', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      outline: async () => ({ documentId: 'd1', nodes: [] }), trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
      mediaPageCount: () => 0,
    }
    const stream = new ManagedBrowserStream({
      runtime: runtime as never,
      mobileJpegFrameIntervalMs: 10,
      mobileJpegInteractionBurstFrames: 2,
      preferredMediaRoute: 'jpeg-only',
    })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 'animation', tabId: 'tab' })
    const frames: number[] = []
    client.on('message', (data) => {
      const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: string; sequence?: number; revision?: number; mediaGeneration?: number }
      if (message.type !== 'frame' || message.sequence === undefined || message.revision === undefined || message.mediaGeneration === undefined) return
      frames.push(message.sequence)
      client.send(JSON.stringify({ type: 'frame-ack', sequence: message.sequence, revision: message.revision, mediaGeneration: message.mediaGeneration }))
    })
    let animation: ReturnType<typeof setInterval> | undefined
    try {
      harness.hello(client)
      await vi.waitFor(() => { expect(frames).toEqual([1]) })
      animation = setInterval(() => { cdp.emit('Page.screencastFrame', { data: 'animation', sessionId: 1 }) }, 1)
      await vi.waitFor(() => { expect(frames).toHaveLength(3) })
      await new Promise((resolve) => { setTimeout(resolve, 60) })
      expect(frames).toHaveLength(3)

      clearInterval(animation)
      animation = undefined
      for (let index = 0; index < 20; index += 1) {
        client.send(JSON.stringify({ type: 'input', revision: 1, input: { type: 'tap', x: 10, y: 10 } }))
        await vi.waitFor(() => { expect(frames).toHaveLength(4 + index) })
      }
      animation = setInterval(() => { cdp.emit('Page.screencastFrame', { data: 'animation', sessionId: 2 }) }, 1)
      await vi.waitFor(() => { expect(frames).toHaveLength(25) })
      await new Promise((resolve) => { setTimeout(resolve, 60) })
      expect(frames).toHaveLength(25)
      expect(captureTimes.slice(1).every((value, index) => value - captureTimes[index]! >= 8)).toBe(true)
      expect(stream.diagnostics().fallbackBytes).toBeGreaterThan(0)
    } finally {
      if (animation !== undefined) clearInterval(animation)
      await harness.dispose()
    }
  })

  it('keeps screencast metadata diagnostic and gates input and ACK by committed layout', async () => {
    let now = 1_000
    let layout: BrowserLayout = { revision: 4, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 3 }
    const clips: Array<Record<string, unknown>> = []
    const inputs: Array<Record<string, unknown>> = []
    const sourceAcks: number[] = []
    const lifecycle: string[] = []
    const cdp = new EventEmitter() as EventEmitter & { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
    cdp.send = async (method, params = {}) => {
      if (method === 'Page.startScreencast' || method === 'Page.stopScreencast') lifecycle.push(method)
      if (method === 'Page.captureScreenshot') {
        clips.push(params.clip as Record<string, unknown>)
        return { data: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64') }
      }
      if (method === 'Page.screencastFrameAck') sourceAcks.push(Number(params.sessionId))
      if (method === 'Input.dispatchMouseEvent') inputs.push(params)
      return method === 'Page.getLayoutMetrics' ? { visualViewport: { pageX: 0, pageY: 0 } } : {}
    }
    const runtime = {
      target: () => ({ page: { viewportSize: () => layout.viewport }, cdp, layout }),
      ownedTarget: () => ({ page: { viewportSize: () => layout.viewport }, cdp, layout }),
      runInput: async (_tab: unknown, _target: unknown, _layout: unknown, action: (session: typeof cdp, current: () => boolean) => Promise<void>) => { await action(cdp, () => true); return true },
      keyOf: () => 's:t',
      touch: () => {},
      acquire: () => () => {},
      layout: () => ({ ...layout, viewport: { ...layout.viewport } }),
      layoutPolicy: () => ({ minViewport: { width: 320, height: 240 }, maxViewport: { width: 1920, height: 1440 }, settleMs: 180, hysteresisPx: 8 }),
      verifyLayout: async () => {
        lifecycle.push('verify')
        cdp.emit('Page.screencastFrame', { data: 'verification-echo', sessionId: 92 })
        return layout
      },
      projection: () => ({ tabId: 't', url: 'https://example.test', title: 'Example', documentId: 'd1', status: 'ready' }),
      proposeLayout: async (_tab: unknown, proposal: { mode: BrowserLayout['mode']; viewport: BrowserLayout['viewport'] }) => {
        lifecycle.push('propose')
        cdp.emit('Page.screencastFrame', { data: 'proposal-echo', sessionId: 91 })
        layout = { revision: layout.revision + 1, mediaGeneration: layout.mediaGeneration + 1, mode: proposal.mode, viewport: proposal.viewport }
        return layout
      },
      outline: async () => ({ documentId: 'd1', nodes: [] }),
      trackRect: async () => ({ documentId: 'd1', selector: '', rect: null }),
    }
    const stream = new ManagedBrowserStream({ runtime: runtime as never, now: () => now })
    const harness = await ManagedBrowserStreamHarness.start(stream)
    const client = await harness.connect({ sessionId: 's', tabId: 't' })
    const messages: Array<Record<string, unknown>> = []
    client.on('message', (data) => { messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>) })
    try {
      harness.hello(client, { frameEncodings: ['binary-v2', 'json-base64-v2'] })
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'frame')).toBe(true) })
      expect(messages.find((message) => message.type === 'ready')).toMatchObject({ version: 2, frameEncoding: 'json-base64-v2', flowControl: 'frame-ack-v2' })
      expect(messages.find((message) => message.type === 'layout-commit')).toMatchObject({ layout })
      const first = messages.find((message) => message.type === 'frame') as { sequence: number; revision: number; mediaGeneration: number; viewport: object }
      expect(first).toMatchObject({ revision: 4, mediaGeneration: 3, viewport: { width: 1280, height: 800 } })
      expect(clips).toEqual([expect.objectContaining({ width: 1280, height: 800 })])
      expect(sourceAcks).toEqual([92])

      client.send(JSON.stringify({ type: 'input', revision: 99, input: { type: 'tap', x: 20, y: 30 } }))
      await vi.waitFor(() => { expect(messages.some((message) => message.type === 'input-result')).toBe(true) })
      expect(inputs).toEqual([])
      client.send(JSON.stringify({ type: 'input', revision: 4, input: { type: 'tap', x: 20, y: 30 } }))
      await vi.waitFor(() => { expect(inputs).toHaveLength(2) })

      now += 250
      client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'laptop', viewport: { width: 1280, height: 800 } }))
      await vi.waitFor(() => { expect(messages.filter((message) => message.type === 'frame')).toHaveLength(2) })
      expect(lifecycle).toEqual([
        'Page.startScreencast', 'verify',
        'Page.stopScreencast', 'propose', 'Page.startScreencast', 'verify',
      ])
      expect(sourceAcks).toEqual([92, 91, 92])
      const second = messages.filter((message) => message.type === 'frame')[1] as { sequence: number; revision: number; mediaGeneration: number }
      expect(second).toMatchObject({ revision: 5, mediaGeneration: 4, viewport: { width: 1280, height: 800 } })

      client.send(JSON.stringify({ type: 'frame-ack', sequence: first.sequence, revision: 4, mediaGeneration: 3 }))
      now += 300
      cdp.emit('Page.screencastFrame', { data: 'ignored', sessionId: 11, metadata: { deviceWidth: 390, deviceHeight: 844, pageScaleFactor: 2 } })
      await new Promise((resolve) => { setTimeout(resolve, 30) })
      expect(messages.filter((message) => message.type === 'frame')).toHaveLength(2)
      client.send(JSON.stringify({ type: 'frame-ack', sequence: second.sequence, revision: 5, mediaGeneration: 4 }))
      cdp.emit('Page.screencastFrame', { data: 'current', sessionId: 12, metadata: { deviceWidth: 1280, deviceHeight: 800, pageScaleFactor: 1 } })
      await vi.waitFor(() => { expect(messages.filter((message) => message.type === 'frame')).toHaveLength(3) })
      const third = messages.filter((message) => message.type === 'frame')[2]
      expect(third).toMatchObject({ revision: 5, mediaGeneration: 4, viewport: { width: 1280, height: 800 } })
      expect(clips.at(-1)).toMatchObject({ width: 1280, height: 800 })
      expect(sourceAcks).toEqual([92, 91, 92, 11, 12])
    } finally {
      client.close()
      await vi.waitFor(() => { expect(stream.resources()).toMatchObject({ sockets: 0, timers: 0, captures: 0, unackedFrames: 0 }) })
      await harness.dispose()
    }
  })

  it('recaptures with bounded quality and scale without changing the CSS viewport', async () => {
    const attempts: Array<{ quality: number; clip: { width: number; height: number; scale: number } }> = []
    const cdp = {
      async send(method: string, params?: Record<string, unknown>) {
        if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 4, pageY: 8 } }
        const value = params as { quality: number; clip: { width: number; height: number; scale: number } }
        attempts.push(value)
        const bytes = attempts.length < 3 ? 120 : 60
        return { data: Buffer.alloc(bytes, attempts.length).toString('base64') }
      },
    }
    const profile: Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'> = { quality: 80, maxScale: 1.5, maxRawBytes: 80 }
    await expect(captureBrowserJpegWithinBudget(cdp as never, { width: 1280, height: 800 }, profile)).resolves.toMatchObject({
      jpeg: expect.objectContaining({ byteLength: 60 }),
      encodedSize: { width: 960, height: 600 },
      quality: 45,
      scale: 0.75,
    })
    expect(attempts).toHaveLength(3)
    expect(attempts.every((attempt) => attempt.clip.width === 1280 && attempt.clip.height === 800)).toBe(true)
    expect(attempts.every((attempt) => attempt.clip.width !== 960)).toBe(true)
  })

  it('normalizes screenshot clip scale so forced DPR does not multiply the encoded CSS size', async () => {
    const clips: Array<{ width: number; height: number; scale: number }> = []
    const cdp = {
      async send(method: string, params?: Record<string, unknown>) {
        if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 0, pageY: 0 } }
        clips.push((params as { clip: { width: number; height: number; scale: number } }).clip)
        return { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') }
      },
    }

    await expect(captureBrowserJpegWithinBudget(
      cdp as never,
      { width: 1280, height: 800 },
      { quality: 80, maxScale: 1.5, maxRawBytes: 1024 },
      {},
      2,
    )).resolves.toMatchObject({ encodedSize: { width: 1920, height: 1200 }, scale: 1.5 })
    await expect(captureBrowserJpegWithinBudget(
      cdp as never,
      { width: 390, height: 844 },
      { quality: 65, maxScale: 1, maxRawBytes: 1024 },
      {},
      2,
    )).resolves.toMatchObject({ encodedSize: { width: 390, height: 844 }, scale: 1 })

    expect(clips).toEqual([
      { x: 0, y: 0, width: 1280, height: 800, scale: 0.75 },
      { x: 0, y: 0, width: 390, height: 844, scale: 0.5 },
    ])
  })

  it('drops a capture that completes after its layout generation changed', async () => {
    let release: (() => void) | undefined
    let current: BrowserLayout = { revision: 1, mode: 'fit', viewport: { width: 800, height: 600 }, mediaGeneration: 1 }
    const cdp = {
      async send(method: string) {
        if (method === 'Page.getLayoutMetrics') return { visualViewport: { pageX: 0, pageY: 0 } }
        await new Promise<void>((resolve) => { release = resolve })
        return { data: Buffer.from([1, 2, 3]).toString('base64') }
      },
    }
    const onStaleDrop = vi.fn()
    const capture = captureBrowserJpegForLayout(
      cdp as never,
      current,
      () => current,
      { quality: 80, maxScale: 1, maxRawBytes: 100 },
      { onStaleDrop },
    )
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    current = { revision: 2, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 2 }
    release?.()
    await expect(capture).resolves.toBeUndefined()
    expect(onStaleDrop).toHaveBeenCalledOnce()
  })
})
