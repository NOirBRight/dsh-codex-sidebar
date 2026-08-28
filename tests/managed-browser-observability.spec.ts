import { describe, expect, it } from 'vitest'
import { ManagedBrowserLayoutClient } from '../src/client/managed-browser-layout.ts'
import { publishBrowserPresentation } from '../src/client/managed-browser-observability.ts'
import { BrowserVideoPresentationSwitch } from '../src/client/managed-browser-webrtc-dom.ts'

class FakeVideo {
  hidden = false
  muted = false
  autoplay = false
  playsInline = false
  srcObject: unknown = null
  readyState = 2
  videoWidth = 0
  videoHeight = 0
  play(): Promise<void> { return Promise.resolve() }
  pause(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

function layout(): ManagedBrowserLayoutClient {
  const client = new ManagedBrowserLayoutClient({
    mode: 'laptop',
    settleMs: 120,
    hysteresisPx: 8,
    viewportLimits: { min: { width: 320, height: 240 }, max: { width: 1920, height: 1440 } },
  })
  client.observeContainer({ width: 900, height: 700 }, 0)
  expect(client.acceptCommit({ revision: 4, mode: 'laptop', viewport: { width: 1280, height: 800 }, mediaGeneration: 9 })).toBe(true)
  return client
}

describe('managed Browser presentation observability', () => {
  it('reports encoded-size changes without replacing the Host committed viewport or surface', () => {
    const client = layout()
    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1920, height: 1200 },
    }).accepted).toBe(true)
    const dense = publishBrowserPresentation(undefined, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: { presenter: 'canvas' },
    })!

    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 960, height: 600 },
    }).accepted).toBe(true)
    const bounded = publishBrowserPresentation(undefined, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: { presenter: 'canvas' },
    })!

    expect(dense.committed).toEqual(bounded.committed)
    expect(dense.presented).toEqual(bounded.presented)
    expect(dense.surface).toEqual({ width: 900, height: 563 })
    expect(bounded.surface).toEqual(dense.surface)
    expect([dense.encodedSize, bounded.encodedSize]).toEqual([
      { width: 1920, height: 1200 },
      { width: 960, height: 600 },
    ])
    expect(dense.presenter).toEqual({ kind: 'canvas', identity: { revision: 4, mediaGeneration: 9 } })
  })

  it('keeps exactly one identity-matched presenter across video and Canvas route switches', () => {
    const client = layout()
    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1280, height: 800 },
    }).accepted).toBe(true)
    const first = new FakeVideo()
    const second = new FakeVideo()
    const canvas = { style: { opacity: '' } }
    const presentation = new BrowserVideoPresentationSwitch(
      [first as never, second as never],
      canvas,
      () => ({}),
    )

    const stage = presentation.stage(1_000)
    first.videoWidth = 1920
    first.videoHeight = 1200
    expect(presentation.commit(stage)).toBe(true)
    const direct = publishBrowserPresentation(undefined, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'direct-video', source: presentation.snapshot(),
    })!
    expect(direct.presenter).toEqual({
      kind: 'video',
      slot: 0,
      identity: { revision: 4, mediaGeneration: 9 },
      intrinsicSize: { width: 1920, height: 1200 },
    })
    expect([first.hidden, second.hidden, canvas.style.opacity]).toEqual([false, true, '0'])

    presentation.showCanvas()
    const fallback = publishBrowserPresentation(undefined, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: presentation.snapshot(),
    })!
    expect(fallback.presenter).toEqual({ kind: 'canvas', identity: { revision: 4, mediaGeneration: 9 } })
    expect([first.hidden, second.hidden, canvas.style.opacity]).toEqual([true, true, '1'])
    expect(fallback.committed).toEqual(direct.committed)
    expect(fallback.surface).toEqual(direct.surface)
  })

  it('writes one non-sensitive atomic DOM observation value', () => {
    const client = layout()
    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1280, height: 800 },
    }).accepted).toBe(true)
    const attributes = new Map<string, string>()
    publishBrowserPresentation({ setAttribute(name, value) { attributes.set(name, value) } }, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: { presenter: 'canvas' },
    })

    expect([...attributes.keys()]).toEqual(['data-browser-presentation'])
    expect(JSON.parse(attributes.get('data-browser-presentation') ?? '')).toEqual({
      version: 1,
      connection: 'connected',
      committed: { mode: 'laptop', revision: 4, mediaGeneration: 9, viewport: { width: 1280, height: 800 } },
      presented: { mode: 'laptop', revision: 4, mediaGeneration: 9, viewport: { width: 1280, height: 800 } },
      encodedSize: { width: 1280, height: 800 },
      surface: { width: 900, height: 563 },
      mediaRoute: 'low-bandwidth-fallback',
      presenter: { kind: 'canvas', identity: { revision: 4, mediaGeneration: 9 } },
    })
    expect(attributes.get('data-browser-presentation')).not.toContain('url')
    expect(attributes.get('data-browser-presentation')).not.toContain('title')
  })

  it('atomically clears current layout and presenter when the connection disconnects', () => {
    const client = layout()
    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1280, height: 800 },
    }).accepted).toBe(true)
    const messages: unknown[] = []
    const target = { setAttribute(_name: string, value: string) { messages.push(JSON.parse(value)) } }
    publishBrowserPresentation(target, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'direct-video',
      source: { presenter: 'video', slot: 0, intrinsicSize: { width: 1280, height: 800 } },
    })
    publishBrowserPresentation(target, {
      connection: 'disconnected', layout: client.snapshot(), mediaRoute: 'reconnecting',
      source: { presenter: 'video', slot: 0, intrinsicSize: { width: 1280, height: 800 } },
    })

    expect(messages.at(-1)).toEqual({
      version: 1,
      connection: 'disconnected',
      committed: null,
      presented: null,
      encodedSize: null,
      surface: null,
      mediaRoute: 'reconnecting',
      presenter: { kind: 'none' },
    })
  })

  it('publishes route and presenter as one state after each DOM switch', () => {
    const client = layout()
    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 9,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1280, height: 800 },
    }).accepted).toBe(true)
    const first = new FakeVideo()
    const second = new FakeVideo()
    const canvas = { style: { opacity: '' } }
    const presentation = new BrowserVideoPresentationSwitch([first as never, second as never], canvas, () => ({}))
    const messages: Array<{ mediaRoute: string; presenter: { kind: string } }> = []
    const target = { setAttribute(_name: string, value: string) { messages.push(JSON.parse(value)) } }
    publishBrowserPresentation(target, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: presentation.snapshot(),
    })

    expect(publishBrowserPresentation(target, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'direct-video', source: presentation.snapshot(),
    })).toBeUndefined()
    expect(messages).toHaveLength(1)

    const stage = presentation.stage(1_000)
    first.videoWidth = 1280
    first.videoHeight = 800
    expect(presentation.commit(stage)).toBe(true)
    expect(messages).toHaveLength(1)
    publishBrowserPresentation(target, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'direct-video', source: presentation.snapshot(),
    })

    presentation.showCanvas()
    expect(messages).toHaveLength(2)
    publishBrowserPresentation(target, {
      connection: 'connected', layout: client.snapshot(), mediaRoute: 'low-bandwidth-fallback', source: presentation.snapshot(),
    })
    expect(messages.map((message) => [message.mediaRoute, message.presenter.kind])).toEqual([
      ['low-bandwidth-fallback', 'canvas'],
      ['direct-video', 'video'],
      ['low-bandwidth-fallback', 'canvas'],
    ])
  })
})
