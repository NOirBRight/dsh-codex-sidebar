import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSidebarSession, type Annotation, type FilesPort } from '../src/session.ts'
import { SidebarController } from '../src/client/controller.ts'
import {
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
  SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT,
  SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT,
} from '../src/contract.ts'

const files: FilesPort = {
  read(path) {
    return path === 'src/Login.tsx' ? '<h1>Sign in</h1>' : undefined
  },
  tree() {
    return [{ path: 'src/Login.tsx', name: 'Login.tsx' }]
  },
}


function controllerContext(session: object, call: (...args: never[]) => Promise<unknown>) {
  return {
    get: () => ({ rpc: { call } }),
    layout: {},
    sessions: {
      list: { getSnapshot: () => ({ current: 'sess-a', ids: ['sess-a'], byId: { 'sess-a': { id: 'sess-a', cwd: '/tmp/work' } } }) },
      binding: () => ({ session }),
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }
}

function stackedSnapshot() {
  const box = createSidebarSession({
    sessionId: 'sess-a',
    files,
    persist: { load: () => undefined, save: () => undefined },
    isBusy: () => false,
  })
  box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
  box.dispatch({ type: 'set-annotate', on: true })
  box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
  box.dispatch({ type: 'set-note-draft', text: 'keep stacked' })
  box.dispatch({ type: 'note-add' })
  return box.snapshot()
}

describe('annotation effect prompts', () => {
  it('does not merge leftover composer chips into a direct single-note send', async () => {
    const snapshot = stackedSnapshot()
    const current: Annotation = {
      id: 'current',
      text: 'send only this',
      from: 'Login.tsx:2',
      source: 'files',
      selector: 'src/Login.tsx:2',
      path: 'src/Login.tsx',
      line: 2,
    }
    const prompts: string[] = []
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async (content: Array<{ type: string; text?: string }>) => {
        prompts.push(content.map((part) => part.text ?? '').join('\n'))
        return 'accepted'
      },
    }
    const staged: unknown[] = []
    const ctx = {
      get: () => ({
        rpc: {
          call: async (_channel: string, endpoint: string) => {
            if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot } }
            if (endpoint === SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT) {
              staged.push('stage')
              return { ok: true, value: { staged: true } }
            }
            if (endpoint === SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT) return { ok: true, value: { unstaged: true } }
            return {
              ok: true,
              value: {
                snapshot,
                effects: [{ type: 'send', text: current.text, attachments: [current] }],
              },
            }
          },
        },
      }),
      layout: {},
      sessions: {
        list: {
          getSnapshot: () => ({
            current: 'sess-a',
            ids: ['sess-a'],
            byId: { 'sess-a': { id: 'sess-a', cwd: '/tmp/work' } },
          }),
        },
        binding: () => ({ session }),
      },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    }

    const controller = new SidebarController(ctx as never)
    await controller.refresh('sess-a')
    await controller.dispatch('sess-a', { type: 'note-send' })

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toBe('send only this')
    expect(prompts[0]).not.toContain('keep stacked')
    expect(controller.snap('sess-a')?.attachments.map((item) => item.text)).toEqual(['keep stacked'])
    expect(staged.length).toBeGreaterThan(0)
  })

  it('stages stacked chips immediately and clears them after an official user turn', async () => {
    const snapshot = stackedSnapshot()
    const cleared = { ...snapshot, attachments: [] }
    const staged: unknown[][] = []
    let messages: Array<{ role: string }> = []
    const listeners = new Set<() => void>()
    const session = {
      getSnapshot: () => ({ running: false, messages }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      prompt: async () => 'accepted',
    }
    const ctx = {
      get: () => ({
        rpc: {
          call: async (_channel: string, endpoint: string, payload: unknown) => {
            if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot } }
            if (endpoint === SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT) {
              staged.push((payload as { attachments: unknown[] }).attachments)
              return { ok: true, value: { staged: true } }
            }
            if (endpoint === SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT) return { ok: true, value: { unstaged: true } }
            if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) return { ok: true, value: { snapshot: cleared, effects: [] } }
            return { ok: false, error: { message: 'unknown' } }
          },
        },
      }),
      layout: {},
      sessions: {
        list: {
          getSnapshot: () => ({
            current: 'sess-a',
            ids: ['sess-a'],
            byId: { 'sess-a': { id: 'sess-a', cwd: '/tmp/work' } },
          }),
        },
        binding: () => ({ session }),
      },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    }

    const controller = new SidebarController(ctx as never)
    await controller.refresh('sess-a')
    expect(staged.at(-1)).toEqual(snapshot.attachments)

    messages = [{ role: 'user' }]
    for (const listener of listeners) listener()
    await vi.waitFor(() => {
      expect(controller.snap('sess-a')?.attachments).toEqual([])
    })
  })

  it('commits Browser evidence and sends text followed by one image', async () => {
    const evidence = {
      id: 'e1', captureId: 'capture-1', documentId: 'doc-1',
      ref: '0123456789abcdefabcd/00000000000000000000000000000001.jpg',
      mediaType: 'image/jpeg' as const, width: 720, height: 860,
    }
    const box = createSidebarSession({
      sessionId: 'sess-a', files, persist: { load: () => undefined, save: () => undefined }, isBusy: () => false,
      browser: {
        load: (url) => ({ url, title: 'Example', elements: [] }),
        openExternal() {}, isBusy: () => false,
      },
    })
    box.dispatch({ type: 'open-url', url: 'https://example.com' })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({ type: 'browser-click-content', mark: 'Save', x: 10, y: 20, captureId: 'capture-1', documentId: 'doc-1', rect: { x: 1, y: 2, w: 30, h: 20 } })
    box.dispatch({ type: 'browser-set-note-draft', text: 'fix this' })
    const prompted: Array<Array<Record<string, unknown>>> = []
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async (content: Array<Record<string, unknown>>) => { prompted.push(content); return 'accepted' },
    }
    const ctx = controllerContext(session, async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
      if (endpoint === SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT) return { ok: true, value: evidence }
      if (endpoint === SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT) return { ok: true, value: { staged: true } }
      if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
        const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
        const effects = box.dispatch(intent)
        return { ok: true, value: { snapshot: box.snapshot(), effects } }
      }
      return { ok: false, error: { message: 'unknown' } }
    })
    const controller = new SidebarController(ctx as never)
    await controller.refresh('sess-a')
    await controller.dispatch('sess-a', { type: 'browser-note-send' })
    expect(prompted).toHaveLength(1)
    expect(prompted[0]).toEqual([{ type: 'text', text: 'fix this' }])
  })

  it('recovers the Host snapshot after a transient RPC failure without opening this client', async () => {
    vi.useFakeTimers()
    try {
      const snapshot = stackedSnapshot()
      const session = {
        getSnapshot: () => ({ running: false, messages: [] }),
        prompt: async () => 'accepted',
      }
      let calls = 0
      const ctx = controllerContext(session, async (_channel: string, endpoint: string) => {
        if (endpoint !== SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: false }
        calls += 1
        if (calls === 1) return { ok: false }
        return { ok: true, value: { snapshot } }
      })
      const controller = new SidebarController(ctx as never)
      const refreshing = controller.refresh('sess-a')
      await vi.runAllTimersAsync()
      await expect(refreshing).resolves.toEqual({ ...snapshot, collapsed: true })
      expect(calls).toBe(2)
      expect(controller.snap('sess-a')?.collapsed).toBe(true)
      expect(controller.snap('sess-a')?.tabs.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reveals and hides the panel locally before the Host dispatch round-trip completes', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    let releaseDispatch: (() => void) | undefined
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve })
    let dispatchDone = 0
    const base = controllerContext(session, async (_channel: string, endpoint: string, payload?: unknown) => {
      if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
      if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
        await dispatchGate
        const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
        const effects = box.dispatch(intent)
        dispatchDone += 1
        return { ok: true, value: { snapshot: box.snapshot(), effects } }
      }
      return { ok: false }
    })
    const controller = new SidebarController({ ...base, layout } as never)
    await controller.refresh('sess-a')
    expect(controller.snap('sess-a')?.collapsed).toBe(true)

    controller.reveal('sess-a')
    expect(layout.openDetails).toHaveBeenCalledTimes(1)
    expect(controller.snap('sess-a')?.collapsed).toBe(false)

    controller.hide('sess-a')
    expect(layout.closeDetails).toHaveBeenCalled()
    expect(controller.snap('sess-a')?.collapsed).toBe(true)

    releaseDispatch?.()
    await vi.waitFor(() => { expect(dispatchDone).toBe(1) })
    expect(controller.snap('sess-a')?.collapsed).toBe(true)
    expect(layout.openDetails).toHaveBeenCalledTimes(1)
  })

  it('does not open this client when another surface already expanded the Host 侧栏', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    expect(box.snapshot().collapsed).toBe(false)
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const call = async (_channel: string, endpoint: string, payload?: unknown) => {
      if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
      if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
        const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
        const effects = box.dispatch(intent)
        return { ok: true, value: { snapshot: box.snapshot(), effects } }
      }
      return { ok: false }
    }
    const webLayout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const phoneLayout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const web = new SidebarController({ ...controllerContext(session, call), layout: webLayout } as never)
    const phone = new SidebarController({ ...controllerContext(session, call), layout: phoneLayout } as never)

    await web.refresh('sess-a')
    web.reveal('sess-a')
    expect(webLayout.openDetails).toHaveBeenCalled()
    expect(web.snap('sess-a')?.collapsed).toBe(false)

    await phone.refresh('sess-a')
    expect(phone.snap('sess-a')?.collapsed).toBe(true)
    expect(phone.snap('sess-a')?.tabs).toEqual(web.snap('sess-a')?.tabs)
    expect(phoneLayout.openDetails).not.toHaveBeenCalled()
  })

  it('reveals this client immediately when a hidden client opens a path', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    let releaseDispatch: (() => void) | undefined
    const dispatchGate = new Promise<void>((resolve) => { releaseDispatch = resolve })
    const controller = new SidebarController({
      ...controllerContext(session, async (_channel: string, endpoint: string, payload?: unknown) => {
        if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
        if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
          await dispatchGate
          const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
          const effects = box.dispatch(intent)
          return { ok: true, value: { snapshot: box.snapshot(), effects } }
        }
        return { ok: false }
      }),
      layout,
    } as never)

    await controller.refresh('sess-a')
    controller.reveal('sess-a')
    controller.hide('sess-a')
    expect(controller.snap('sess-a')?.collapsed).toBe(true)

    const opening = controller.dispatch('sess-a', { type: 'open-path', path: 'src/Login.tsx' })
    expect(controller.snap('sess-a')?.collapsed).toBe(false)
    expect(layout.openDetails).toHaveBeenCalledTimes(2)

    releaseDispatch?.()
    await opening
    expect(controller.snap('sess-a')?.files.path).toBe('src/Login.tsx')
    expect(controller.snap('sess-a')?.collapsed).toBe(false)
  })

  it('reveals this client when the host layout opens details', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const openDetails = vi.fn()
    const layout = { openDetails, closeDetails: vi.fn() }
    const controller = new SidebarController({
      ...controllerContext(session, async (_channel: string, endpoint: string) => {
        if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
        return { ok: false }
      }),
      layout,
    } as never)
    await controller.refresh('sess-a')
    expect(controller.snap('sess-a')?.collapsed).toBe(true)
    controller.installPathTakeover()
    layout.openDetails()
    expect(openDetails).toHaveBeenCalled()
    expect(controller.snap('sess-a')?.collapsed).toBe(false)
  })

  it('still intercepts layout.details and transcript URLs when openPath is missing', () => {
    const openDetails = vi.fn()
    const layout = { openDetails, closeDetails: vi.fn() }
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const controller = new SidebarController({
      ...controllerContext(session, async () => ({ ok: false })),
      layout,
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    } as never)
    expect(() => { controller.installPathTakeover() }).not.toThrow()
    layout.openDetails()
    expect(openDetails).toHaveBeenCalled()
  })

  it('still opens this client when it opens a path itself', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const controller = new SidebarController({
      ...controllerContext(session, async (_channel: string, endpoint: string, payload?: unknown) => {
        if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
        if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
          const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
          const effects = box.dispatch(intent)
          return { ok: true, value: { snapshot: box.snapshot(), effects } }
        }
        return { ok: false }
      }),
      layout,
    } as never)
    await controller.refresh('sess-a')
    expect(controller.snap('sess-a')?.collapsed).toBe(true)
    await controller.dispatch('sess-a', { type: 'open-path', path: 'src/Login.tsx' })
    expect(controller.snap('sess-a')?.collapsed).toBe(false)
    expect(layout.openDetails).toHaveBeenCalled()
  })

  it('does not project all-session context for ordinary Tab open and close intents', async () => {
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: { load: () => undefined, save: () => undefined },
      isBusy: () => false,
    })
    const currentSession = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async () => 'accepted',
    }
    let otherSessionReads = 0
    const dispatchPayloads: Array<{ logs?: unknown }> = []
    const call = async (_channel: string, endpoint: string, payload?: unknown) => {
      if (endpoint === SIDEBAR_SNAPSHOT_ENDPOINT) return { ok: true, value: { snapshot: box.snapshot() } }
      if (endpoint === SIDEBAR_DISPATCH_ENDPOINT) {
        dispatchPayloads.push(payload as { logs?: unknown })
        const intent = (payload as { intent: Parameters<typeof box.dispatch>[0] }).intent
        const effects = box.dispatch(intent)
        return { ok: true, value: { snapshot: box.snapshot(), effects } }
      }
      return { ok: false }
    }
    const base = controllerContext(currentSession, call)
    const controller = new SidebarController({
      ...base,
      sessions: {
        list: {
          getSnapshot: () => ({
            current: 'sess-a',
            ids: ['sess-a', 'sess-b'],
            byId: {
              'sess-a': { id: 'sess-a', cwd: '/tmp/work' },
              'sess-b': { id: 'sess-b', cwd: '/tmp/other' },
            },
          }),
        },
        binding: (sessionId: string) => ({
          session: sessionId === 'sess-a'
            ? currentSession
            : {
                getSnapshot: () => {
                  otherSessionReads += 1
                  return { running: false, messages: [{ role: 'assistant', content: 'large history' }] }
                },
              },
        }),
      },
    } as never)

    await controller.refresh('sess-a')
    await controller.dispatch('sess-a', { type: 'open-path', path: 'src/Login.tsx' })
    const tabId = controller.snap('sess-a')?.active
    expect(tabId).toBeTruthy()
    await controller.dispatch('sess-a', { type: 'close-tab', id: tabId as string })

    expect(otherSessionReads).toBe(0)
    expect(dispatchPayloads).toHaveLength(2)
    expect(dispatchPayloads.every(payload => JSON.stringify(payload.logs) === '{}')).toBe(true)
    expect(dispatchPayloads.every(payload => JSON.stringify((payload as { roster?: unknown }).roster) === '[]')).toBe(true)

    await controller.dispatch('sess-a', { type: 'side-inspect', tabId: 'side-1', sessionId: 'sess-b' })
    expect(otherSessionReads).toBe(1)
    expect((dispatchPayloads[2]?.logs as Record<string, unknown[]>)['sess-b']).toHaveLength(1)
    expect((dispatchPayloads[2] as { roster: unknown[] }).roster).toHaveLength(2)
  })

  it('does not wrap the official session.prompt', () => {
    const source = readFileSync(new URL('../src/client/controller.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('#wrapPrompt')
    expect(source).not.toContain('formatHumanSend')
  })

})
