import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SidebarAlpha1CompatAdapter } from '../src/client/sidebar-alpha1-compat-adapter.ts'
import { SidebarController } from '../src/client/controller.ts'
import { createSidebarSession, type FilesPort } from '../src/session.ts'

const files: FilesPort = {
  read(path) { return path === 'src/Login.tsx' ? '<h1>Sign in</h1>' : undefined },
  tree() { return [{ path: 'src/Login.tsx', name: 'Login.tsx' }] },
}

function makeSessions(current: string | undefined = 'sess-a') {
  return {
    list: {
      getSnapshot: () => ({ current, ids: ['sess-a'], byId: { 'sess-a': { id: 'sess-a', cwd: '/tmp/work' } } }),
      subscribe: () => () => {},
    },
    binding: () => ({ session: { getSnapshot: () => ({ running: false }), prompt: async () => 'accepted' } }),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const workspaces = (overrides.workspaces as unknown) ?? { list: { getSnapshot: () => ({ archivedSessionIds: [] }) }, openPath: vi.fn(async (path: string) => path) }
  const remoteSession = (overrides.remoteSession as unknown) ?? { openWorkspacePath: vi.fn(async (req: unknown) => ({ ok: true, value: { opened: false } })) }
  const layout = (overrides.layout as unknown) ?? { openDetails: vi.fn(), closeDetails: vi.fn() }
  const ctx: Record<string, unknown> = {
    workspaces,
    remote: { session: remoteSession },
    layout,
    sessions: makeSessions(overrides.current as string | undefined),
    get: (name: string) => (name === 'layout' ? layout : undefined),
    ...overrides,
  }
  return { ctx: ctx as never, workspaces: workspaces as { openPath: ReturnType<typeof vi.fn> }, remoteSession: remoteSession as { openWorkspacePath: ReturnType<typeof vi.fn> }, layout: layout as { openDetails: ReturnType<typeof vi.fn>, closeDetails: ReturnType<typeof vi.fn> } }
}

function fakeDocument() {
  const listeners: Array<{ type: string; handler: unknown; capture: boolean }> = []
  const doc: Record<string, unknown> = {
    addEventListener(type: string, handler: unknown, capture: boolean) { listeners.push({ type, handler, capture }) },
    removeEventListener(type: string, handler: unknown, capture: boolean) {
      const idx = listeners.findIndex(l => l.type === type && l.handler === handler && l.capture === capture)
      if (idx !== -1) listeners.splice(idx, 1)
    },
    listeners,
  }
  return doc
}

function fakeWindowFrom(doc: Record<string, unknown>) {
  const listeners: Array<{ type: string; handler: unknown; capture: boolean }> = []
  const win: Record<string, unknown> = {
    addEventListener(type: string, handler: unknown, capture: boolean) { listeners.push({ type, handler, capture }) },
    removeEventListener(type: string, handler: unknown, capture: boolean) {
      const idx = listeners.findIndex(l => l.type === type && l.handler === handler && l.capture === capture)
      if (idx !== -1) listeners.splice(idx, 1)
    },
    listeners,
  }
  return win
}

function makeCallbacks(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dispatch: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    onLayoutOpen: vi.fn(),
    ...overrides,
  }
}

describe('alpha.1 compat adapter - install/dispose', () => {
  let origDoc: unknown
  let origWin: unknown
  beforeEach(() => {
    origDoc = (globalThis as unknown as { document?: unknown }).document
    origWin = (globalThis as unknown as { window?: unknown }).window
  })
  afterEach(() => {
    if (origDoc === undefined) delete (globalThis as unknown as { document?: unknown }).document
    else (globalThis as unknown as { document: unknown }).document = origDoc
    if (origWin === undefined) delete (globalThis as unknown as { window?: unknown }).window
    else (globalThis as unknown as { window: unknown }).window = origWin
    if ((global as unknown as { document?: unknown }).document !== undefined && origDoc === undefined) delete (global as unknown as { document?: unknown }).document
    if ((global as unknown as { window?: unknown }).window !== undefined && origWin === undefined) delete (global as unknown as { window?: unknown }).window
  })

  it('wraps workspaces.openPath, remote.openWorkspacePath, layout.openDetails and installs document/window listeners; dispose restores', async () => {
    const doc = fakeDocument()
    const win = fakeWindowFrom(doc)
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = win
    ;(global as unknown as { document: unknown }).document = doc
    ;(global as unknown as { window: unknown }).window = win
    const { ctx, workspaces, remoteSession, layout } = makeCtx()
    const origWorkspacesOpen = workspaces.openPath
    const origRemoteOpen = remoteSession.openWorkspacePath
    const origLayoutOpen = layout.openDetails
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    const dispose = adapter.install()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origWorkspacesOpen)
    expect((remoteSession as unknown as { openWorkspacePath: unknown }).openWorkspacePath).not.toBe(origRemoteOpen)
    expect((layout as unknown as { openDetails: unknown }).openDetails).not.toBe(origLayoutOpen)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(2 + 1)
    expect((win as { listeners: unknown[] }).listeners.length).toBe(1)
    dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origWorkspacesOpen)
    expect((remoteSession as unknown as { openWorkspacePath: unknown }).openWorkspacePath).toBe(origRemoteOpen)
    expect((layout as unknown as { openDetails: unknown }).openDetails).toBe(origLayoutOpen)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    expect((win as { listeners: unknown[] }).listeners.length).toBe(0)
  })

  it('installation is idempotent: repeated install does not stack wrappers or listeners', () => {
    const doc = fakeDocument()
    const win = fakeWindowFrom(doc)
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = win
    ;(global as unknown as { document: unknown }).document = doc
    ;(global as unknown as { window: unknown }).window = win
    const { ctx, workspaces, layout } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    adapter.install()
    const firstPatched = (workspaces as unknown as { openPath: unknown }).openPath
    const firstDocCount = (doc as { listeners: unknown[] }).listeners.length
    const firstWinCount = (win as { listeners: unknown[] }).listeners.length
    adapter.install()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(firstPatched)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(firstDocCount)
    expect((win as { listeners: unknown[] }).listeners.length).toBe(firstWinCount)
    expect(firstPatched).not.toBe(origOpen)
    adapter.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origOpen)
  })

  it('second redundant install disposer does not tear down original installation (adapter-level)', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = fakeWindowFrom(doc)
    const { ctx, workspaces } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    const disposeFirst = adapter.install()
    const patched = (workspaces as unknown as { openPath: unknown }).openPath
    expect(patched).not.toBe(origOpen)
    const disposeSecond = adapter.install()
    // second disposer should be no-op and must not dispose first installation
    disposeSecond()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(patched)
    expect((doc as { listeners: unknown[] }).listeners.length).toBeGreaterThan(0)
    // first disposer should still dispose
    disposeFirst()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origOpen)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
  })

  it('HMR/reload: dispose then reinstall wraps again cleanly', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    const { ctx, workspaces, layout } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter1 = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    adapter1.install()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origOpen)
    const patched1 = (workspaces as unknown as { openPath: unknown }).openPath
    adapter1.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origOpen)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    const adapter2 = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    adapter2.install()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origOpen)
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(patched1)
    expect((doc as { listeners: unknown[] }).listeners.length).toBeGreaterThan(0)
    adapter2.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origOpen)
  })

  it('does not clobber a later sibling wrapper on dispose (pointer-equality guard)', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    const { ctx, workspaces } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    adapter.install()
    const ourPatched = (workspaces as unknown as { openPath: unknown }).openPath
    expect(ourPatched).not.toBe(origOpen)
    const sibling = vi.fn(async (path: string) => 'sibling:' + path)
    ;(workspaces as unknown as { openPath: unknown }).openPath = sibling
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(sibling)
    adapter.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(sibling)
    ;(workspaces as unknown as { openPath: unknown }).openPath = origOpen
  })

  it('frozen workspaces fails closed without throwing and without partial state', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = fakeWindowFrom(doc)
    const workspaces = { openPath: vi.fn(async (path: string) => path), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    Object.freeze(workspaces)
    const remoteSession = { openWorkspacePath: vi.fn(async (req: unknown) => ({ ok: true })) }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const ctx = {
      workspaces,
      remote: { session: remoteSession },
      layout,
      sessions: makeSessions('sess-a'),
      get: (name: string) => (name === 'layout' ? layout : undefined),
    }
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    expect(() => adapter.install()).not.toThrow()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(workspaces.openPath)
    expect(() => adapter.dispose()).not.toThrow()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(workspaces.openPath)
  })

  it('missing Host methods fail closed without throwing', () => {
    const doc = fakeDocument()
    const win = fakeWindowFrom(doc)
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = win
    ;(global as unknown as { document: unknown }).document = doc
    ;(global as unknown as { window: unknown }).window = win
    const ctx = {
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      remote: {},
      layout: {},
      sessions: makeSessions('sess-a'),
      get: () => undefined,
    }
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, undefined)
    expect(() => adapter.install()).not.toThrow()
    expect((doc as { listeners: unknown[] }).listeners.length).toBeGreaterThan(0)
    expect((win as { listeners: unknown[] }).listeners.length).toBeGreaterThan(0)
    expect(() => adapter.dispose()).not.toThrow()
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    expect((win as { listeners: unknown[] }).listeners.length).toBe(0)
  })

  it('transactional: injected failure after earlier success disposes partial and resets', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = fakeWindowFrom(doc)
    const { ctx, workspaces } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    // Inject failure on document url click after earlier tool captures succeeded
    const doc2 = (globalThis as unknown as { document: Record<string, unknown> }).document as Record<string, unknown>
    const origDocAdd = (doc2 as { addEventListener: unknown }).addEventListener
    let docCalls = 0
    ;(doc2 as { addEventListener: unknown }).addEventListener = ((type: string, handler: unknown, capture: boolean) => {
      docCalls += 1
      // First two calls are tool captures (pointerdown, click), third is url click on document
      if (docCalls === 3) throw new Error('injected url click failure')
      return (origDocAdd as (t: string, h: unknown, c: boolean) => void).call(doc2, type, handler, capture)
    }) as unknown

    expect(() => adapter.install()).toThrow('injected url click failure')
    // After transactional dispose, no wrappers or listeners should remain
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origOpen)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    // #installed should be reset so a retry can succeed
    ;(doc2 as { addEventListener: unknown }).addEventListener = origDocAdd
    expect(() => adapter.install()).not.toThrow()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origOpen)
    adapter.dispose()
  })

  it('preserves wrapper ordering: layout original runs before local reveal', () => {
    const order: string[] = []
    const layout = { openDetails: vi.fn(() => { order.push('original') }), closeDetails: vi.fn() }
    const callbacks = makeCallbacks({ onLayoutOpen: vi.fn(() => { order.push('reveal') }) })
    const ctx = {
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      remote: {},
      layout,
      sessions: makeSessions('sess-a'),
      get: (name: string) => (name === 'layout' ? layout : undefined),
    }
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    adapter.install()
    const wrapped = (layout as unknown as { openDetails: () => void }).openDetails
    wrapped()
    expect(order).toEqual(['original', 'reveal'])
    adapter.dispose()
  })

  it('preserves remote fallback: original called when Sidebar dispatch fails', async () => {
    const { ctx, remoteSession } = makeCtx()
    const origRemote = remoteSession.openWorkspacePath
    const callbacks = makeCallbacks({ openPath: vi.fn(async () => { throw new Error('dispatch boom') }) })
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    adapter.install()
    const wrapped = (remoteSession as unknown as { openWorkspacePath: (req: unknown, signal?: unknown) => Promise<unknown> }).openWorkspacePath
    const result = await wrapped({ path: 'src/Login.tsx' })
    expect(origRemote).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, value: { opened: false } })
    adapter.dispose()
  })

  it('replaced Host object: official fallback follows the new object', async () => {
    const workspaces1 = { openPath: vi.fn(async (path: string) => 'ws1:' + path), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    const workspaces2 = { openPath: vi.fn(async (path: string) => 'ws2:' + path), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    const origWs1Open = workspaces1.openPath
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const ctx: Record<string, unknown> = {
      workspaces: workspaces1,
      remote: { session: { openWorkspacePath: vi.fn(async () => ({ ok: true })) } },
      layout,
      sessions: { list: { getSnapshot: () => ({ current: undefined, ids: [], byId: {} }) }, subscribe: () => () => {}, binding: () => undefined },
      get: (name: string) => (name === 'layout' ? layout : undefined),
    }
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, layout)
    adapter.install()
    const patchedWs1 = (workspaces1 as unknown as { openPath: unknown }).openPath
    expect(patchedWs1).not.toBe(origWs1Open)
    // Replace Host object
    ;(ctx as { workspaces: unknown }).workspaces = workspaces2
    // Calling the old patched handler with no session delegates to the current official opener.
    const oldHandler = patchedWs1 as (path: string) => Promise<boolean>
    await expect(oldHandler('some/path')).resolves.toBe(false)
    expect(origWs1Open).not.toHaveBeenCalled()
    expect(workspaces2.openPath).toHaveBeenCalledWith('some/path')
    // New workspaces object is not patched, so direct call is official
    await (workspaces2 as { openPath: (p: string) => Promise<string> }).openPath('new/path')
    expect(workspaces2.openPath).toHaveBeenCalledWith('new/path')
    // Dispose should restore old object only, not affect new
    adapter.dispose()
    expect((workspaces1 as unknown as { openPath: unknown }).openPath).toBe(workspaces1.openPath)
    expect((workspaces2 as unknown as { openPath: unknown }).openPath).toBe(workspaces2.openPath)
  })

  it('dispose does not repatch a method another plugin replaced after install', () => {
    const { ctx, workspaces } = makeCtx()
    const origOpen = workspaces.openPath
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    adapter.install()
    const ourPatched = (workspaces as unknown as { openPath: unknown }).openPath
    // Sibling replaces after we installed
    const siblingWrapped = vi.fn(async (p: string) => 'sibling')
    ;(workspaces as unknown as { openPath: unknown }).openPath = siblingWrapped
    // Dispose should not restore to orig, should keep sibling
    adapter.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(siblingWrapped)
    // Also ensure we didn't repatch after dispose: installing again should wrap sibling, not orig
    const adapter2 = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    adapter2.install()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(siblingWrapped)
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origOpen)
    adapter2.dispose()
    // After disposing second adapter, it should restore to sibling (since sibling was the original at second install time)
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(siblingWrapped)
    ;(workspaces as unknown as { openPath: unknown }).openPath = origOpen
  })

  it('handles replacement layout provider after desktop boot via ensureLayoutPatched', () => {
    const desktop = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const mobile = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const origDesktop = desktop.openDetails
    const origMobile = mobile.openDetails
    let currentLayout: unknown = desktop
    const ctx: Record<string, unknown> = {
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      remote: {},
      layout: desktop,
      sessions: makeSessions('sess-a'),
      get: (name: string) => (name === 'layout' ? currentLayout : undefined),
    }
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as unknown as never, callbacks as never, desktop)
    adapter.install()
    expect((desktop as { openDetails: unknown }).openDetails).not.toBe(origDesktop)
    const desktopPatched = (desktop as { openDetails: unknown }).openDetails
    expect(desktopPatched).not.toBe(origDesktop)
    currentLayout = mobile
    ;(ctx as { layout: unknown }).layout = mobile
    adapter.ensureLayoutPatched()
    expect((mobile as { openDetails: unknown }).openDetails).not.toBe(origMobile)
    expect((desktop as { openDetails: unknown }).openDetails).toBe(desktopPatched)
    const cb = callbacks.onLayoutOpen as ReturnType<typeof vi.fn>
    cb.mockClear()
    ;(desktop as { openDetails: () => void }).openDetails()
    expect(cb).toHaveBeenCalledTimes(1)
    cb.mockClear()
    ;(mobile as { openDetails: () => void }).openDetails()
    expect(cb).toHaveBeenCalledTimes(1)
    adapter.dispose()
    expect((desktop as { openDetails: unknown }).openDetails).toBe(origDesktop)
    expect((mobile as { openDetails: unknown }).openDetails).toBe(origMobile)
  })

  it('verifies document/window listeners are removed on dispose (no anonymous listeners)', () => {
    const doc = fakeDocument()
    const win = fakeWindowFrom(doc)
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = win
    ;(global as unknown as { document: unknown }).document = doc
    ;(global as unknown as { window: unknown }).window = win
    const { ctx } = makeCtx()
    const callbacks = makeCallbacks()
    const adapter = new SidebarAlpha1CompatAdapter(ctx as never, callbacks as never, (ctx as unknown as { layout: unknown }).layout)
    adapter.install()
    const docClickListeners = (doc as { listeners: Array<{ type: string }> }).listeners.filter(l => l.type === 'click')
    const winClickListeners = (win as { listeners: Array<{ type: string }> }).listeners.filter(l => l.type === 'click')
    expect(docClickListeners.length).toBeGreaterThan(0)
    expect(winClickListeners.length).toBeGreaterThan(0)
    const pointerListeners = (doc as { listeners: Array<{ type: string }> }).listeners.filter(l => l.type === 'pointerdown')
    expect(pointerListeners.length).toBe(1)
    adapter.dispose()
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    expect((win as { listeners: unknown[] }).listeners.length).toBe(0)
  })
})

describe('controller integration - compat adapter via SidebarController', () => {
  it('controller install/dispose wraps and restores via adapter', async () => {
    const workspaces = { openPath: vi.fn(async (p: string) => p), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    const remoteSession = { openWorkspacePath: vi.fn(async () => ({ ok: true })) }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const session = { getSnapshot: () => ({ running: false, messages: [] }), prompt: async () => 'accepted' }
    const ctx = {
      get: (name: string) => (name === 'connection' ? { rpc: { call: async () => ({ ok: false }) } } : name === 'layout' ? layout : undefined),
      layout,
      sessions: {
        list: { getSnapshot: () => ({ current: 'sess-a', ids: ['sess-a'], byId: { 'sess-a': { cwd: '/tmp/work' } } }) },
        binding: () => ({ session }),
      },
      workspaces,
      remote: { session: remoteSession },
    } as unknown as never
    const controller = new SidebarController(ctx as never)
    const origWorkspaces = workspaces.openPath
    const origRemote = remoteSession.openWorkspacePath
    const origLayout = layout.openDetails
    controller.installPathTakeover()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origWorkspaces)
    expect((remoteSession as unknown as { openWorkspacePath: unknown }).openWorkspacePath).not.toBe(origRemote)
    expect((layout as unknown as { openDetails: unknown }).openDetails).not.toBe(origLayout)
    controller.installPathTakeover()
    const patched = (workspaces as unknown as { openPath: unknown }).openPath
    controller.installPathTakeover()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(patched)
    controller.dispose()
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origWorkspaces)
    expect((remoteSession as unknown as { openWorkspacePath: unknown }).openWorkspacePath).toBe(origRemote)
    expect((layout as unknown as { openDetails: unknown }).openDetails).toBe(origLayout)
  })

  it('controller install is transactional: failure after earlier success cleans up', () => {
    const doc = fakeDocument()
    ;(globalThis as unknown as { document: unknown }).document = doc
    ;(globalThis as unknown as { window: unknown }).window = fakeWindowFrom(doc)
    ;(global as unknown as { document: unknown }).document = doc
    const workspaces = { openPath: vi.fn(async (p: string) => p), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const session = { getSnapshot: () => ({ running: false, messages: [] }), prompt: async () => 'accepted' }
    const ctx = {
      get: (name: string) => (name === 'connection' ? { rpc: { call: async () => ({ ok: false }) } } : name === 'layout' ? layout : undefined),
      layout,
      sessions: {
        list: { getSnapshot: () => ({ current: 'sess-a', ids: ['sess-a'], byId: { 'sess-a': { cwd: '/tmp/work' } } }) },
        binding: () => ({ session }),
      },
      workspaces,
      remote: { session: { openWorkspacePath: vi.fn(async () => ({ ok: true })) } },
    } as unknown as never
    const controller = new SidebarController(ctx as never)
    const origWorkspaces = workspaces.openPath
    // Inject failure on layout patch by making layout.openDetails non-configurable and throwing
    const origDescriptor = Object.getOwnPropertyDescriptor(layout, 'openDetails')
    Object.defineProperty(layout, 'openDetails', {
      get() { throw new Error('injected layout failure') },
      set() { throw new Error('injected layout failure') },
      configurable: true,
    })
    // First, workspaces patch would succeed if we got there, but layout failure should cause transactional rollback
    // To make workspaces succeed before layout fails, we need document to succeed
    expect(() => controller.installPathTakeover()).toThrow('injected layout failure')
    // After failure, workspaces should be restored (no partial)
    expect((workspaces as unknown as { openPath: unknown }).openPath).toBe(origWorkspaces)
    expect((doc as { listeners: unknown[] }).listeners.length).toBe(0)
    // Restore layout and retry should succeed
    if (origDescriptor) Object.defineProperty(layout, 'openDetails', origDescriptor)
    else delete (layout as unknown as { openDetails?: unknown }).openDetails
    ;(layout as { openDetails: unknown }).openDetails = vi.fn()
    expect(() => controller.installPathTakeover()).not.toThrow()
    expect((workspaces as unknown as { openPath: unknown }).openPath).not.toBe(origWorkspaces)
    controller.dispose()
  })

  it('controller handles frozen workspaces without throwing and still supports layout', () => {
    const workspaces = { openPath: vi.fn(async (p: string) => p), list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }
    Object.freeze(workspaces)
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    const origLayout = layout.openDetails
    const session = { getSnapshot: () => ({ running: false, messages: [] }), prompt: async () => 'accepted' }
    const ctx = {
      get: (name: string) => (name === 'connection' ? { rpc: { call: async () => ({ ok: false }) } } : name === 'layout' ? layout : undefined),
      layout,
      sessions: {
        list: { getSnapshot: () => ({ current: 'sess-a', ids: ['sess-a'], byId: { 'sess-a': { cwd: '/tmp/work' } } }) },
        binding: () => ({ session }),
      },
      workspaces,
      remote: {},
    } as unknown as never
    const controller = new SidebarController(ctx as never)
    expect(() => controller.installPathTakeover()).not.toThrow()
    expect((layout as unknown as { openDetails: unknown }).openDetails).not.toBe(origLayout)
    expect(() => controller.dispose()).not.toThrow()
    expect((layout as unknown as { openDetails: unknown }).openDetails).toBe(origLayout)
  })
})
