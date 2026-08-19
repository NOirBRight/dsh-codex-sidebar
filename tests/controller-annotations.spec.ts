import { describe, expect, it, vi } from 'vitest'
import { createSidebarSession, type Annotation, type FilesPort } from '../src/session.ts'
import { SidebarController } from '../src/client/controller.ts'
import {
  SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT,
  SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT,
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_SNAPSHOT_ENDPOINT,
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
    let rpcCalls = 0
    const ctx = {
      get: () => ({
        rpc: {
          call: async () => {
            rpcCalls += 1
            if (rpcCalls === 1) return { ok: true, value: { snapshot } }
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
    expect(prompts[0]).toContain('send only this')
    expect(prompts[0]).not.toContain('keep stacked')
    expect(controller.snap('sess-a')?.attachments.map((item) => item.text)).toEqual(['keep stacked'])
  })

  it('lets the resident empty composer submit stacked annotations without leaking its sentinel', async () => {
    const snapshot = stackedSnapshot()
    const cleared = { ...snapshot, attachments: [] }
    const prompts: string[] = []
    const session = {
      getSnapshot: () => ({ running: false, messages: [] }),
      prompt: async (content: Array<{ type: string; text?: string }>) => {
        prompts.push(content.map((part) => part.text ?? '').join('\n'))
        return 'accepted'
      },
    }
    let rpcCalls = 0
    const ctx = {
      get: () => ({
        rpc: {
          call: async () => {
            rpcCalls += 1
            if (rpcCalls === 1) return { ok: true, value: { snapshot } }
            return { ok: true, value: { snapshot: cleared, effects: [] } }
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
    await session.prompt([{ type: 'text', text: '\u200b' }])

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('keep stacked')
    expect(prompts[0]).not.toContain('\u200b')
    expect(controller.snap('sess-a')?.attachments).toEqual([])
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
      if (endpoint === SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT) return { ok: true, value: { mediaType: 'image/jpeg', data: 'jpeg-base64' } }
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
    expect(prompted[0]?.[0]).toMatchObject({ type: 'text', text: expect.stringContaining('fix this') })
    expect(prompted[0]?.[1]).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'jpeg-base64', name: 'browser-e1.jpg' })
  })

  it('recovers the expanded 侧栏 after a transient snapshot RPC failure', async () => {
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
      await expect(refreshing).resolves.toEqual(snapshot)
      expect(calls).toBe(2)
      expect(controller.snap('sess-a')?.collapsed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

})
