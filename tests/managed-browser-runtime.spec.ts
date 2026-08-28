import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { LocalHtmlGateway } from '../src/local-html-gateway.ts'
import { findBrowserExecutable, MANAGED_BROWSER_CACHE_BUDGET_BYTES, ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

class FakePage {
  currentUrl = 'about:blank'
  currentTitle = 'Blank'
  closed = false
  clicked: string[] = []
  clickedUrls: string[] = []
  filled: Array<{ selector: string; text: string }> = []
  size = { width: 720, height: 860 }
  domSize = { width: 720, height: 860 }
  domDeviceScaleFactor = 2
  setViewportUpdatesDom = true
  cdpOverrideUpdatesDom = true
  cdpOverrideError: Error | undefined
  cssViewportError: Error | undefined
  history: string[] = []
  resizeCalls: Array<{ width: number; height: number }> = []
  resizeReleases: Array<() => void> = []
  blockResizes = false
  handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  frame = { url: () => this.currentUrl }
  exposedBindings: Array<{ name: string; callback: (source: unknown, payload: unknown) => void }> = []
  evaluations: Array<{ source: string; argument: unknown }> = []
  evaluatedNodes = [{ role: 'button', name: 'Save', selector: '#save', rect: { x: 10, y: 20, w: 80, h: 30 } }]
  onEvaluate: (() => void | Promise<void>) | undefined
  onIsClosed: (() => void) | undefined
  onScreenshot: (() => void | Promise<void>) | undefined
  onClick: (() => void | Promise<void>) | undefined

  async goto(url: string): Promise<void> {
    this.history.push(this.currentUrl)
    this.currentUrl = url
    this.currentTitle = url.includes('external') ? 'External' : 'Example'
    this.emit('framenavigated', this.frame)
  }

  async goBack(): Promise<void> {
    this.currentUrl = this.history.pop() ?? this.currentUrl
    this.emit('framenavigated', this.frame)
  }

  async goForward(): Promise<void> {}
  async reload(): Promise<void> { this.emit('framenavigated', this.frame) }
  async close(): Promise<void> { this.closed = true; this.emit('close') }
  isClosed(): boolean { this.onIsClosed?.(); return this.closed }
  url(): string { return this.currentUrl }
  async title(): Promise<string> { return this.currentTitle }
  viewportSize(): { width: number; height: number } { return this.size }
  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    this.resizeCalls.push(size)
    if (this.blockResizes) await new Promise<void>((resolve) => { this.resizeReleases.push(resolve) })
    this.size = size
    if (this.setViewportUpdatesDom) this.domSize = size
  }
  async evaluate<T>(source?: string, argument?: unknown): Promise<T> {
    if (source !== undefined) this.evaluations.push({ source, argument })
    await this.onEvaluate?.()
    if (source === '({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })') {
      if (this.cssViewportError !== undefined) throw this.cssViewportError
      return { width: this.domSize.width, height: this.domSize.height, deviceScaleFactor: this.domDeviceScaleFactor } as T
    }
    return this.evaluatedNodes as T
  }
  async exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void> {
    this.exposedBindings.push({ name, callback })
  }
  async screenshot(): Promise<Uint8Array> { await this.onScreenshot?.(); return new Uint8Array([1, 2, 3]) }
  locator(selector: string): { click(): Promise<void>; fill(text: string): Promise<void> } {
    return {
      click: async () => { await this.onClick?.(); this.clicked.push(selector); this.clickedUrls.push(this.currentUrl) },
      fill: async (text) => { this.filled.push({ selector, text }) },
    }
  }
  mainFrame(): { url(): string } { return this.frame }
  on(event: string, listener: (...args: never[]) => void): void {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(listener as (...args: unknown[]) => void)
    this.handlers.set(event, handlers)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }
}

function harness(opts: ConstructorParameters<typeof ManagedBrowserRuntime>[0] = {}): {
  runtime: ManagedBrowserRuntime
  pages: FakePage[]
  closed: { context: boolean; sessions: number; createdSessions: number }
  cdpCommands: Array<{ method: string; params?: Record<string, unknown> }>
} {
  const pages: FakePage[] = []
  const closed = { context: false, sessions: 0, createdSessions: 0 }
  const cdpCommands: Array<{ method: string; params?: Record<string, unknown> }> = []
  const runtime = new ManagedBrowserRuntime({
    executablePath: '/bin/true',
    profileDir: '/tmp/dcs-managed-runtime-test-' + Math.random().toString(36).slice(2),
    launch: async () => ({
      async newPage() {
        const page = new FakePage()
        pages.push(page)
        return page
      },
      async newCDPSession(page) {
        closed.createdSessions += 1
        return {
          async send(method, params) {
            cdpCommands.push({ method, ...(params === undefined ? {} : { params }) })
            if (method === 'Emulation.setDeviceMetricsOverride' && (page as FakePage).cdpOverrideError !== undefined) {
              throw (page as FakePage).cdpOverrideError
            }
            if (method === 'Emulation.setDeviceMetricsOverride' && (page as FakePage).cdpOverrideUpdatesDom) {
              ;(page as FakePage).domSize = { width: Number(params?.width), height: Number(params?.height) }
            }
          },
          on() {},
          off() {},
          async detach() { closed.sessions += 1 },
        }
      },
      on() {},
      async close() { closed.context = true },
    }),
    ...opts,
  })
  return { runtime, pages, closed, cdpCommands }
}

class GatedLocalHtmlGateway extends LocalHtmlGateway {
  readonly opens: string[] = []
  readonly revokedNavigations: string[] = []
  readonly firstStarted: Promise<void>
  #resolveFirstStarted!: () => void
  #resumeFirst!: () => void
  #firstGate: Promise<void>
  #active: string | undefined
  #publicByNavigation = new Map<string, string>()

  constructor() {
    super()
    this.firstStarted = new Promise((resolve) => { this.#resolveFirstStarted = resolve })
    this.#firstGate = new Promise((resolve) => { this.#resumeFirst = resolve })
  }

  override async open(_owner: string, publicUrl: string): Promise<{ publicUrl: string; navigationUrl: string }> {
    const sequence = this.opens.length + 1
    const navigationUrl = `http://127.0.0.1:9/.dcs-test/${sequence}/index.html`
    this.opens.push(publicUrl)
    this.#publicByNavigation.set(navigationUrl, publicUrl)
    this.#active = navigationUrl
    if (sequence === 1) {
      this.#resolveFirstStarted()
      await this.#firstGate
    }
    return { publicUrl, navigationUrl }
  }

  resumeFirst(): void { this.#resumeFirst() }

  override project(_owner: string, navigationUrl: string): string | undefined {
    const publicUrl = this.#publicByNavigation.get(navigationUrl)
    if (publicUrl !== undefined && navigationUrl !== this.#active) this.revokedNavigations.push(navigationUrl)
    return publicUrl
  }

  override isPrivate(navigationUrl: string): boolean {
    return navigationUrl.startsWith('http://127.0.0.1:9/.dcs-test/')
  }
}

function cacheContext(expectClear: boolean, clearError?: Error): {
  context: {
    newPage(): Promise<FakePage>
    newCDPSession(page: unknown): Promise<{ send(method: string): Promise<void>; on(): void; off(): void; detach(): Promise<void> }>
    on(): void
    close(): Promise<void>
  }
  temporaryPage: FakePage
  managedPages: FakePage[]
  cacheCommands: string[]
  observation: { cacheDetached: boolean; contextClosed: boolean }
} {
  const temporaryPage = new FakePage()
  const managedPages: FakePage[] = []
  const cacheCommands: string[] = []
  const observation = { cacheDetached: false, contextClosed: false }
  let temporaryClaimed = false
  return {
    temporaryPage,
    managedPages,
    cacheCommands,
    observation,
    context: {
      async newPage() {
        if (expectClear && !temporaryClaimed) {
          temporaryClaimed = true
          return temporaryPage
        }
        const page = new FakePage()
        managedPages.push(page)
        return page
      },
      async newCDPSession(page) {
        if (page === temporaryPage && expectClear) {
          return {
            async send(method) {
              cacheCommands.push(method)
              if (method === 'Network.clearBrowserCache' && clearError !== undefined) throw clearError
            },
            on() {},
            off() {},
            async detach() { observation.cacheDetached = true },
          }
        }
        return { async send() {}, on() {}, off() {}, async detach() {} }
      },
      on() {},
      async close() { observation.contextClosed = true },
    },
  }
}

function cacheContextThatClosesDuringClear(): {
  context: {
    newPage(): Promise<FakePage>
    newCDPSession(page: unknown): Promise<{ send(method: string): Promise<void>; on(): void; off(): void; detach(): Promise<void> }>
    on(event: 'close', listener: () => void): void
    close(): Promise<void>
  }
  temporaryPage: FakePage
  cacheCommands: string[]
} {
  const temporaryPage = new FakePage()
  const cacheCommands: string[] = []
  const closeHandlers: Array<() => void> = []
  let temporaryClaimed = false
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    for (const listener of closeHandlers) listener()
  }
  return {
    temporaryPage,
    cacheCommands,
    context: {
      async newPage() {
        if (!temporaryClaimed) {
          temporaryClaimed = true
          return temporaryPage
        }
        if (closed) throw new Error('browserContext.newPage: Target page, context or browser has been closed')
        return new FakePage()
      },
      async newCDPSession(page) {
        if (page === temporaryPage) {
          return {
            async send(method) {
              cacheCommands.push(method)
              if (method === 'Network.clearBrowserCache') close()
            },
            on() {},
            off() {},
            async detach() {},
          }
        }
        return { async send() {}, on() {}, off() {}, async detach() {} }
      },
      on(event, listener) { if (event === 'close') closeHandlers.push(listener) },
      async close() { close() },
    },
  }
}

describe('ManagedBrowserRuntime', () => {
  it('navigates through the private local HTML gateway but projects only public file URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-managed-local-html-'))
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Local</title>')
    await writeFile(join(root, 'next.html'), '<!doctype html><title>Next</title>')
    const target = pathToFileURL(join(root, 'index.html')).href + '#start'
    const next = pathToFileURL(join(root, 'next.html')).href
    const box = harness()
    const tab = { sessionId: 'local', tabId: 'html' }

    const opened = await box.runtime.ensure(tab, target)
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    expect(page.currentUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(page.currentUrl).not.toContain('/tmp/')
    expect(opened).toMatchObject({ status: 'ready', url: target })
    expect(JSON.stringify(opened)).not.toContain(new URL(page.currentUrl).port)

    page.currentUrl = new URL('next.html', page.currentUrl).href
    page.currentTitle = page.currentUrl
    page.emit('framenavigated', page.frame)
    page.emit('domcontentloaded')
    await vi.waitFor(() => { expect(box.runtime.projection(tab)?.url).toBe(next) })
    expect(box.runtime.projection(tab)?.title).not.toMatch(/127\.0\.0\.1|\.dcs-local-html|[A-Za-z0-9_-]{24}/)

    await box.runtime.close(tab)
    expect(box.runtime.localHtmlResources()).toEqual({ listening: true, leases: 0 })
    await box.runtime.dispose()
    expect(box.runtime.localHtmlResources()).toEqual({ listening: false, leases: 0 })
    await rm(root, { recursive: true, force: true })
  })

  it('redacts private local HTML routes from snapshot and outline accessible names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-managed-local-html-names-'))
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Local</title>')
    const target = pathToFileURL(join(root, 'index.html')).href
    const box = harness()
    const tab = { sessionId: 'local', tabId: 'accessible-name' }

    await box.runtime.ensure(tab, target)
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    const privateUrl = page.currentUrl
    page.evaluatedNodes = [{ role: 'heading', name: `Current URL: ${privateUrl}`, selector: '#current-url', rect: { x: 0, y: 0, w: 200, h: 40 } }]

    const published = JSON.stringify({
      snapshot: await box.runtime.snapshot(tab),
      outline: await box.runtime.outline(tab),
    })
    expect(published).toContain('local-html://gateway/index.html')
    expect(published).not.toContain(new URL(privateUrl).origin)
    expect(published).not.toContain('/.dcs-local-html/')

    await box.runtime.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects invalid local HTML before creating a Chromium Page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-managed-local-html-invalid-'))
    await writeFile(join(root, 'page.txt'), 'not html')
    const box = harness()
    const result = await box.runtime.ensure({ sessionId: 'local', tabId: 'invalid' }, pathToFileURL(join(root, 'page.txt')).href)
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('local HTML') })
    expect(box.pages).toEqual([])
    expect(box.runtime.localHtmlResources()).toEqual({ listening: false, leases: 0 })
    await box.runtime.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('revokes a local HTML capability when Chromium cannot start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-managed-local-html-launch-'))
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Local</title>')
    const box = harness({ launch: async () => { throw new Error('launch failed') } })
    await expect(box.runtime.ensure({ sessionId: 'local', tabId: 'failed-launch' }, pathToFileURL(join(root, 'index.html')).href)).rejects.toThrow('launch failed')
    expect(box.runtime.localHtmlResources()).toEqual({ listening: true, leases: 0 })
    await box.runtime.dispose()
    expect(box.runtime.localHtmlResources()).toEqual({ listening: false, leases: 0 })
    await rm(root, { recursive: true, force: true })
  })

  it('serializes concurrent local HTML ensures for one Tab and creates one Page identity', async () => {
    const localHtmlGateway = new GatedLocalHtmlGateway()
    const box = harness({ localHtmlGateway })
    const tab = { sessionId: 'local', tabId: 'concurrent' }
    const firstUrl = 'file:///tmp/first/index.html'
    const secondUrl = 'file:///tmp/second/index.html'

    const first = box.runtime.ensure(tab, firstUrl)
    await localHtmlGateway.firstStarted
    const second = box.runtime.ensure(tab, secondUrl)
    const opensBeforeFirstResumes = [...localHtmlGateway.opens]
    localHtmlGateway.resumeFirst()
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(opensBeforeFirstResumes).toEqual([firstUrl])
    expect(localHtmlGateway.opens).toEqual([firstUrl, secondUrl])
    expect(localHtmlGateway.revokedNavigations).toEqual([])
    expect(firstResult.url).toBe(firstUrl)
    expect(secondResult.url).toBe(secondUrl)
    expect(box.runtime.projection(tab)?.url).toBe(secondUrl)
    expect(box.pages).toHaveLength(1)
    expect(box.closed.createdSessions).toBe(1)
    const target = box.runtime.target(tab)
    expect(target?.page).toBe(box.pages[0])
    await box.runtime.proposeLayout(tab, { mode: 'laptop', viewport: { width: 1, height: 1 } })
    expect(box.runtime.target(tab)?.page).toBe(target?.page)
    expect(box.pages[0]?.viewportSize()).toEqual(box.runtime.layout(tab)?.viewport)
    await box.runtime.dispose()
  })

  it('cancels a pending Page identity when its Tab closes', async () => {
    const page = new FakePage()
    let signalStarted!: () => void
    let resumePage!: () => void
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const gate = new Promise<void>((resolve) => { resumePage = resolve })
    let cdpSessions = 0
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-pending-close-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { signalStarted(); await gate; return page },
        async newCDPSession() { cdpSessions += 1; return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'pending', tabId: 'close' }
    const opening = runtime.ensure(tab, 'https://example.com')
    await started

    const closing = runtime.close(tab)
    const closedBeforePageResumes = await Promise.race([
      closing.then(() => true),
      new Promise<false>((resolve) => { setImmediate(() => { resolve(false) }) }),
    ])
    resumePage()

    await expect(opening).rejects.toThrow('cancelled')
    await closing
    expect(closedBeforePageResumes).toBe(true)
    expect(cdpSessions).toBe(0)
    expect(page.closed).toBe(true)
    expect(runtime.target(tab)).toBeUndefined()
    await runtime.dispose()
  })

  it('stops waiting for committed Page teardown at the Browser shutdown deadline', async () => {
    const page = new FakePage()
    const never = new Promise<void>(() => {})
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-bounded-close-' + Math.random().toString(36).slice(2),
      browserCleanupTimeoutMs: 20,
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() { await never } } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'close', tabId: 'bounded' }
    await runtime.ensure(tab, 'https://example.com')

    const closing = runtime.close(tab)

    await expect(Promise.race([
      closing.then(() => 'closed'),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('still-waiting') }, 200) }),
    ])).resolves.toBe('closed')
    expect(runtime.target(tab)).toBeUndefined()
    expect(page.closed).toBe(true)
    await runtime.dispose()
  })

  it('never lets an old exact target identity address a replacement record', async () => {
    const box = harness()
    const tab = { sessionId: 'target-identity', tabId: 'replacement' }
    await box.runtime.ensure(tab, 'https://one.example')
    const first = box.runtime.target(tab)
    if (first === undefined) throw new Error('missing first target')

    await box.runtime.close(tab)
    await box.runtime.ensure(tab, 'https://two.example')
    const second = box.runtime.target(tab)
    if (second === undefined) throw new Error('missing replacement target')

    expect(second.identity).not.toBe(first.identity)
    expect(box.runtime.target(tab, first.identity)).toBeUndefined()
    await expect(box.runtime.proposeLayout(
      tab,
      { mode: 'phone', viewport: { width: 390, height: 844 } },
      first.identity,
    )).rejects.toThrow('target is no longer current')
    expect(box.runtime.layout(tab)).toMatchObject({ revision: 1, mode: 'fit', viewport: { width: 720, height: 860 } })
    await expect(box.runtime.proposeLayout(
      tab,
      { mode: 'phone', viewport: { width: 390, height: 844 } },
      second.identity,
    )).resolves.toMatchObject({ revision: 2, mode: 'phone', viewport: { width: 390, height: 844 } })
    await box.runtime.dispose()
  })

  it('invalidates the exact target before closing its Page and CDP', async () => {
    const warnings: string[] = []
    const box = harness({ onWarning: (message) => { warnings.push(message) } })
    const tab = { sessionId: 'target-identity', tabId: 'invalidation' }
    await box.runtime.ensure(tab, 'https://one.example')
    const target = box.runtime.target(tab)
    if (target === undefined) throw new Error('missing target')
    const invalidations: Array<{ tab: typeof tab; identity: object; pageClosed: boolean; detached: number }> = []
    box.runtime.onTargetInvalidated(() => { throw new Error('observer failed') })
    const release = box.runtime.onTargetInvalidated((invalidatedTab, identity) => {
      invalidations.push({ tab: invalidatedTab, identity, pageClosed: box.pages[0]?.closed ?? false, detached: box.closed.sessions })
    })

    await box.runtime.close(tab)

    expect(invalidations).toEqual([{ tab, identity: target.identity, pageClosed: false, detached: 0 }])
    expect(warnings).toEqual(['managed Browser target invalidation observer failed: observer failed'])
    release()
    await box.runtime.dispose()
  })

  it('cancels every pending Page identity on dispose', async () => {
    const page = new FakePage()
    let signalStarted!: () => void
    let resumePage!: () => void
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const gate = new Promise<void>((resolve) => { resumePage = resolve })
    let contextCloseCalls = 0
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-pending-dispose-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { signalStarted(); await gate; return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() { contextCloseCalls += 1 },
      }),
    })
    const opening = runtime.ensure({ sessionId: 'pending', tabId: 'dispose' }, 'https://example.com')
    await started

    const disposing = runtime.dispose()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    const closeCallsBeforePageResumes = contextCloseCalls
    resumePage()

    await expect(opening).rejects.toThrow('cancelled')
    await disposing
    expect(closeCallsBeforePageResumes).toBe(1)
    expect(page.closed).toBe(true)
    expect(runtime.list()).toEqual([])
  })

  it('revokes local HTML immediately and stops waiting at the Browser shutdown deadline', async () => {
    let signalGatewayDisposed!: () => void
    const gatewayDisposed = new Promise<void>((resolve) => { signalGatewayDisposed = resolve })
    class ObservedGateway extends LocalHtmlGateway {
      override async dispose(): Promise<void> { signalGatewayDisposed() }
    }
    const page = new FakePage()
    const never = new Promise<void>(() => {})
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-bounded-dispose-' + Math.random().toString(36).slice(2),
      localHtmlGateway: new ObservedGateway(),
      browserCleanupTimeoutMs: 20,
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() { await never } } },
        on() {},
        async close() { await never },
      }),
    })
    await runtime.ensure({ sessionId: 'dispose', tabId: 'bounded' }, 'https://example.com')

    const disposing = runtime.dispose()
    const revokedImmediately = await Promise.race([
      gatewayDisposed.then(() => true),
      new Promise<false>((resolve) => { setImmediate(() => { resolve(false) }) }),
    ])

    expect(revokedImmediately).toBe(true)
    await expect(Promise.race([
      disposing.then(() => 'disposed'),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('still-waiting') }, 200) }),
    ])).resolves.toBe('disposed')
    expect(runtime.list()).toEqual([])
  })

  it('clears a failed pending Page identity so the same Tab can retry', async () => {
    const page = new FakePage()
    let attempts = 0
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-pending-retry-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() {
          attempts += 1
          if (attempts === 1) throw new Error('newPage failed')
          return page
        },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'pending', tabId: 'retry' }

    await expect(runtime.ensure(tab, 'https://one.example')).rejects.toThrow('newPage failed')
    await expect(runtime.ensure(tab, 'https://two.example')).resolves.toMatchObject({ status: 'ready', url: 'https://two.example' })
    expect(attempts).toBe(2)
    expect(runtime.target(tab)?.page).toBe(page)
    await runtime.dispose()
  })

  it('cancels pending Page creation when its owning Chromium Context closes', async () => {
    const page = new FakePage()
    let contextClosed: (() => void) | undefined
    let signalCdpStarted!: () => void
    let resumeCdp!: () => void
    const cdpStarted = new Promise<void>((resolve) => { signalCdpStarted = resolve })
    const cdpGate = new Promise<void>((resolve) => { resumeCdp = resolve })
    const never = new Promise<void>(() => {})
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-context-generation-' + Math.random().toString(36).slice(2),
      browserCleanupTimeoutMs: 20,
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() {
          signalCdpStarted()
          await cdpGate
          return { async send() {}, on() {}, off() {}, async detach() { await never } }
        },
        on(event, listener) { if (event === 'close') contextClosed = listener },
        async close() {},
      }),
    })
    const tab = { sessionId: 'pending', tabId: 'context-generation' }
    const opening = runtime.ensure(tab, 'https://example.com')
    await cdpStarted

    contextClosed?.()
    resumeCdp()

    await expect(Promise.race([
      opening.then(() => 'resolved', (error: unknown) => error instanceof Error ? error.message : String(error)),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('still-waiting') }, 200) }),
    ])).resolves.toContain('cancelled')
    expect(page.closed).toBe(true)
    expect(runtime.target(tab)).toBeUndefined()
    await runtime.dispose()
  })

  it('cancels pending and queued Page work when its session closes', async () => {
    const page = new FakePage()
    let signalStarted!: () => void
    let resumePage!: () => void
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const gate = new Promise<void>((resolve) => { resumePage = resolve })
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-pending-session-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { signalStarted(); await gate; return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'pending-session', tabId: 'browser' }
    const opening = runtime.ensure(tab, 'https://one.example')
    await started
    const queued = runtime.ensure(tab, 'https://two.example')

    await runtime.closeSession(tab.sessionId)
    resumePage()

    await expect(opening).rejects.toThrow('cancelled')
    await expect(queued).rejects.toThrow('closed')
    expect(page.closed).toBe(true)
    expect(runtime.target(tab)).toBeUndefined()
    await runtime.dispose()
  })

  it('continues a queued valid ensure after an internal self-block reset', async () => {
    const box = harness()
    const tab = { sessionId: 'guard', tabId: 'queued' }
    await box.runtime.ensure(tab, 'https://one.example')

    const blocked = box.runtime.ensure(tab, 'http://127.0.0.1:3080/')
    const valid = box.runtime.ensure(tab, 'https://two.example')

    await expect(blocked).resolves.toMatchObject({ status: 'error' })
    await expect(valid).resolves.toMatchObject({ status: 'ready', url: 'https://two.example' })
    expect(box.runtime.projection(tab)?.url).toBe('https://two.example')
    expect(box.pages).toHaveLength(2)
    expect(box.pages[0]?.closed).toBe(true)
    expect(box.pages[1]?.closed).toBe(false)
    await box.runtime.dispose()
  })

  it('does not publish an obsolete record after its Tab closes', async () => {
    class GatedNavigationPage extends FakePage {
      blockNext = false
      readonly navigationStarted: Promise<void>
      #signalNavigationStarted!: () => void
      #resumeNavigation!: () => void
      #navigationGate: Promise<void>

      constructor() {
        super()
        this.navigationStarted = new Promise((resolve) => { this.#signalNavigationStarted = resolve })
        this.#navigationGate = new Promise((resolve) => { this.#resumeNavigation = resolve })
      }

      resumeNavigation(): void { this.#resumeNavigation() }

      override async goto(url: string): Promise<void> {
        if (!this.blockNext) return super.goto(url)
        this.#signalNavigationStarted()
        await this.#navigationGate
        throw new Error('obsolete navigation failed')
      }
    }
    const page = new GatedNavigationPage()
    const projections: unknown[] = []
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-stale-publish-' + Math.random().toString(36).slice(2),
      onProjection: (projection) => { projections.push(projection) },
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'stale', tabId: 'publish' }
    await runtime.ensure(tab, 'https://one.example')
    projections.length = 0
    page.blockNext = true
    const navigating = runtime.ensure(tab, 'https://two.example')
    await page.navigationStarted

    await runtime.close(tab)
    projections.length = 0
    page.resumeNavigation()
    await navigating

    expect(projections).toEqual([])
    expect(runtime.target(tab)).toBeUndefined()
    await runtime.dispose()
  })

  it('captures exact target Page evidence only while document and layout identity remain stable', async () => {
    const box = harness()
    const tab = { sessionId: 'evidence', tabId: 'page' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')

    await expect(box.runtime.capture(tab, { revision: 99, mediaGeneration: 1 })).resolves.toMatchObject({ ok: false, code: 'stale-layout' })
    expect(page.evaluations).toEqual([])

    await expect(box.runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({
      captureId: expect.any(String), documentId: 'evidence:page:d1', layoutRevision: 1, mediaGeneration: 1,
    })

    page.onScreenshot = async () => {
      page.onScreenshot = undefined
      await box.runtime.proposeLayout(tab, { mode: 'phone', viewport: { width: 1, height: 1 } })
    }
    await expect(box.runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({ ok: false, code: 'stale-layout' })

    page.onEvaluate = async () => {
      page.onEvaluate = undefined
      await page.goto('https://example.com/next')
    }
    await expect(box.runtime.capture(tab, { revision: 2, mediaGeneration: 2 })).resolves.toMatchObject({ ok: false, code: 'stale-layout' })
    await box.runtime.dispose()
  })

  it('drops asynchronous control results when their exact target is replaced', async () => {
    for (const operation of ['outline', 'track-rect'] as const) {
      const box = harness()
      const tab = { sessionId: 'exact-async', tabId: operation }
      await box.runtime.ensure(tab, 'https://one.example')
      const target = box.runtime.target(tab)
      const page = box.pages[0]
      if (target === undefined || page === undefined) throw new Error('missing first target')
      let signalEvaluationStarted!: () => void
      let resumeEvaluation!: () => void
      const evaluationStarted = new Promise<void>((resolve) => { signalEvaluationStarted = resolve })
      const evaluationGate = new Promise<void>((resolve) => { resumeEvaluation = resolve })
      page.onEvaluate = async () => {
        signalEvaluationStarted()
        await evaluationGate
      }
      const result = operation === 'outline'
        ? box.runtime.outline(tab, target.identity)
        : box.runtime.trackRect(tab, '#save', target.identity)
      await evaluationStarted

      await box.runtime.close(tab)
      await box.runtime.ensure(tab, 'https://two.example')
      resumeEvaluation()

      await expect(result).resolves.toMatchObject({ ok: false, code: 'not-ready' })
      await box.runtime.dispose()
    }
  })

  it('drops a snapshot that crosses a navigation on the same Page identity', async () => {
    const box = harness()
    const tab = { sessionId: 'exact-async', tabId: 'snapshot-document' }
    await box.runtime.ensure(tab, 'https://one.example')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing Page')
    let signalEvaluationStarted!: () => void
    let resumeEvaluation!: () => void
    const evaluationStarted = new Promise<void>((resolve) => { signalEvaluationStarted = resolve })
    const evaluationGate = new Promise<void>((resolve) => { resumeEvaluation = resolve })
    page.onEvaluate = async () => {
      page.onEvaluate = undefined
      signalEvaluationStarted()
      await evaluationGate
    }

    const snapshot = box.runtime.snapshot(tab)
    await evaluationStarted
    await box.runtime.ensure(tab, 'https://two.example')
    resumeEvaluation()

    await expect(snapshot).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    await box.runtime.dispose()
  })

  it('does not apply an old document ref after it waited behind another visual operation', async () => {
    const box = harness()
    const tab = { sessionId: 'exact-async', tabId: 'action-document' }
    await box.runtime.ensure(tab, 'https://one.example')
    await box.runtime.snapshot(tab)
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing target')
    let releaseBlocker!: () => void
    let signalBlockerStarted!: () => void
    const blockerStarted = new Promise<void>((resolve) => { signalBlockerStarted = resolve })
    const blocker = box.runtime.runInput(tab, target.identity, {
      revision: target.layout.revision,
      layoutEpoch: target.layoutEpoch,
      documentId: target.documentId,
    }, async () => {
      signalBlockerStarted()
      await new Promise<void>((resolve) => { releaseBlocker = resolve })
    })
    await blockerStarted
    const click = box.runtime.click(tab, '@d1e1')
    await box.runtime.ensure(tab, 'https://two.example')
    releaseBlocker()

    await expect(blocker).resolves.toBe(false)
    await expect(click).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    expect(page.clickedUrls).toEqual([])
    await box.runtime.dispose()
  })

  it('leases narrow owned media Pages from the persistent context with an exact capacity', async () => {
    const box = harness({ maxEncoderPages: 1 })
    await box.runtime.ensure({ sessionId: 'media', tabId: 'target' }, 'https://example.com')
    const pendingMedia = box.runtime.createMediaPage()
    await expect(box.runtime.createMediaPage()).rejects.toThrow('media Page capacity')
    const media = await pendingMedia
    expect(Object.keys(media).sort()).toEqual(['close', 'evaluateFunction', 'exposeBinding'])
    expect(box.runtime.mediaPageCount()).toBe(1)
    await expect(box.runtime.createMediaPage()).rejects.toThrow('media Page capacity')

    let bindingSource: unknown
    await media.exposeBinding('signal', (source) => { bindingSource = source })
    const page = box.pages[1]
    if (page === undefined) throw new Error('missing media Page')
    page.exposedBindings[0]?.callback({ page }, { type: 'connected' })
    expect(bindingSource).toEqual({ page: media })
    await media.evaluateFunction('value => value', { pixel: 'only' })
    expect(page.evaluations).toEqual([{ source: '(value => value)({"pixel":"only"})', argument: undefined }])

    await media.close()
    await media.close()
    expect(page.closed).toBe(true)
    expect(box.runtime.mediaPageCount()).toBe(0)
    const replacement = await box.runtime.createMediaPage()
    await box.runtime.dispose()
    expect(box.pages[2]?.closed).toBe(true)
    await replacement.close()
  })
  it('owns revisioned fixed and clamped fit layouts', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'page' }
    await box.runtime.ensure(tab, 'https://example.com')

    expect(box.runtime.layout(tab)).toEqual({
      revision: 1,
      mode: 'fit',
      viewport: { width: 720, height: 860 },
      mediaGeneration: 1,
    })
    await expect(box.runtime.proposeLayout(tab, {
      mode: 'phone', viewport: { width: 999, height: 999 },
    })).resolves.toEqual({
      revision: 2,
      mode: 'phone',
      viewport: { width: 390, height: 844 },
      mediaGeneration: 2,
    })
    await expect(box.runtime.proposeLayout(tab, {
      mode: 'phone', viewport: { width: 1, height: 1 },
    })).resolves.toMatchObject({ revision: 2, mediaGeneration: 2 })
    await expect(box.runtime.proposeLayout(tab, {
      mode: 'fit', viewport: { width: 10_000, height: 1 },
    })).resolves.toEqual({
      revision: 3,
      mode: 'fit',
      viewport: { width: 1920, height: 240 },
      mediaGeneration: 3,
    })
    expect(box.pages[0]?.resizeCalls).toEqual([
      { width: 390, height: 844 },
      { width: 1920, height: 240 },
    ])
    await box.runtime.dispose()
  })

  it('serializes layout changes and retains only the latest pending proposal', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'latest' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.blockResizes = true

    const first = box.runtime.proposeLayout(tab, { mode: 'fit', viewport: { width: 800, height: 600 } })
    await vi.waitFor(() => { expect(page.resizeCalls).toEqual([{ width: 800, height: 600 }]) })
    const superseded = box.runtime.proposeLayout(tab, { mode: 'fit', viewport: { width: 900, height: 700 } })
    const latest = box.runtime.proposeLayout(tab, { mode: 'laptop', viewport: { width: 1, height: 1 } })
    page.resizeReleases.shift()?.()
    await vi.waitFor(() => { expect(page.resizeCalls).toHaveLength(2) })
    expect(page.resizeCalls[1]).toEqual({ width: 1280, height: 800 })
    page.resizeReleases.shift()?.()

    await expect(first).resolves.toMatchObject({ revision: 2, viewport: { width: 800, height: 600 } })
    await expect(superseded).resolves.toMatchObject({ revision: 3, mode: 'laptop', viewport: { width: 1280, height: 800 } })
    await expect(latest).resolves.toMatchObject({ revision: 3, mode: 'laptop', viewport: { width: 1280, height: 800 } })
    await box.runtime.dispose()
  })

  it('blocks every visual read and input while one exact Page is applying a viewport, then resumes after commit', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'transition-gate' }
    await box.runtime.ensure(tab, 'https://example.com')
    await box.runtime.snapshot(tab)
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing target')
    page.blockResizes = true

    const proposal = box.runtime.proposeLayout(tab, { mode: 'phone', viewport: { width: 390, height: 844 } }, target.identity)
    await vi.waitFor(() => { expect(page.resizeCalls).toEqual([{ width: 390, height: 844 }]) })

    expect(box.runtime.target(tab, target.identity)).toBeUndefined()
    expect(box.runtime.ownedTarget(tab, target.identity)?.identity).toBe(target.identity)
    expect(box.runtime.captureIdentity(tab, target.identity)).toBeUndefined()
    await expect(box.runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({ ok: false })
    await expect(box.runtime.snapshot(tab)).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    await expect(box.runtime.outline(tab, target.identity)).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    await expect(box.runtime.trackRect(tab, '#save', target.identity)).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    await expect(box.runtime.click(tab, '@d1e1')).resolves.toMatchObject({ ok: false, code: 'not-ready' })

    page.resizeReleases.shift()?.()
    await expect(proposal).resolves.toMatchObject({ revision: 2, mediaGeneration: 2, viewport: { width: 390, height: 844 } })
    expect(box.runtime.target(tab, target.identity)?.identity).toBe(target.identity)
    expect(box.runtime.captureIdentity(tab, target.identity)).toMatchObject({ layoutRevision: 2, mediaGeneration: 2 })
    await expect(box.runtime.capture(tab, { revision: 2, mediaGeneration: 2 })).resolves.toMatchObject({ captureId: expect.any(String) })
    await box.runtime.dispose()
  })

  it('rejects a viewport proposal when the exact Page is invalidated after postcondition verification but before commit', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-continuation-race' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing page')
    let closedChecks = 0
    let closing: Promise<void> | undefined
    page.onIsClosed = () => {
      closedChecks += 1
      if (closedChecks !== 3) return
      queueMicrotask(() => { closing = box.runtime.close(tab) })
    }

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'phone', viewport: { width: 390, height: 844 },
    })).rejects.toThrow('closed during layout commit')
    await vi.waitFor(() => { expect(closing).toBeDefined() })
    await closing
    expect(box.runtime.layout(tab)).toBeUndefined()
    await box.runtime.dispose()
  })

  it('drops a capture that spans a completed same-layout viewport verification', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'capture-epoch' }
    await box.runtime.ensure(tab, 'https://example.com')
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing target')
    let releaseScreenshot!: () => void
    const screenshotStarted = new Promise<void>((resolveStarted) => {
      page.onScreenshot = async () => {
        resolveStarted()
        await new Promise<void>((resolve) => { releaseScreenshot = resolve })
      }
    })

    const capture = box.runtime.capture(tab, target.layout)
    await screenshotStarted
    page.domSize = { width: 701, height: 811 }
    await expect(box.runtime.verifyLayout(tab, target.layout, target.identity)).resolves.toEqual(target.layout)
    releaseScreenshot()

    await expect(capture).resolves.toMatchObject({ ok: false, code: 'stale-layout' })
    expect(box.runtime.target(tab, target.identity)?.layoutEpoch).toBe(target.layoutEpoch + 1)
    await box.runtime.dispose()
  })

  it('serializes one complete input gesture ahead of a queued viewport transition', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'input-barrier' }
    await box.runtime.ensure(tab, 'https://example.com')
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing target')
    let releaseGesture!: () => void
    let markGestureStarted!: () => void
    const gestureStarted = new Promise<void>((resolve) => { markGestureStarted = resolve })
    const input = box.runtime.runInput(tab, target.identity, {
      revision: target.layout.revision,
      layoutEpoch: target.layoutEpoch,
      documentId: target.documentId,
    }, async (cdp) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed' })
      markGestureStarted()
      await new Promise<void>((resolve) => { releaseGesture = resolve })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased' })
    })
    await gestureStarted

    const proposal = box.runtime.proposeLayout(tab, { mode: 'phone', viewport: { width: 390, height: 844 } }, target.identity)
    await vi.waitFor(() => { expect(box.runtime.target(tab, target.identity)).toBeUndefined() })
    expect(page.resizeCalls).toEqual([])
    expect(box.cdpCommands.filter(({ method }) => method === 'Input.dispatchMouseEvent')).toEqual([
      { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed' } },
    ])

    releaseGesture()
    await expect(input).resolves.toBe(true)
    await expect(proposal).resolves.toMatchObject({ revision: 2, mediaGeneration: 2 })
    expect(box.cdpCommands.filter(({ method }) => method === 'Input.dispatchMouseEvent')).toEqual([
      { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed' } },
      { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased' } },
    ])
    expect(page.resizeCalls).toEqual([{ width: 390, height: 844 }])
    await box.runtime.dispose()
  })

  it('reports a completed ref action as successful when a viewport transition queued behind it', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'action-before-layout' }
    await box.runtime.ensure(tab, 'https://example.com')
    await box.runtime.snapshot(tab)
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing target')
    let releaseClick!: () => void
    let signalClickStarted!: () => void
    const clickStarted = new Promise<void>((resolve) => { signalClickStarted = resolve })
    page.onClick = async () => {
      signalClickStarted()
      await new Promise<void>((resolve) => { releaseClick = resolve })
    }

    const click = box.runtime.click(tab, '@d1e1')
    await clickStarted
    const proposal = box.runtime.proposeLayout(tab, { mode: 'phone', viewport: { width: 390, height: 844 } }, target.identity)
    await vi.waitFor(() => { expect(box.runtime.target(tab, target.identity)).toBeUndefined() })
    releaseClick()

    await expect(click).resolves.toEqual({ ok: true })
    await expect(proposal).resolves.toMatchObject({ revision: 2, mediaGeneration: 2 })
    expect(page.clicked).toEqual(['#save'])
    await box.runtime.dispose()
  })

  it('falls back to exact-record CDP metrics when Playwright resolves without changing the CSS viewport', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-fallback' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.setViewportUpdatesDom = false

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
    })).resolves.toMatchObject({
      revision: 2,
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
      mediaGeneration: 2,
    })

    expect(box.cdpCommands).toContainEqual({
      method: 'Emulation.setDeviceMetricsOverride',
      params: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 2,
        mobile: false,
        screenWidth: 1280,
        screenHeight: 800,
      },
    })
    expect(page.domSize).toEqual({ width: 1280, height: 800 })
    expect(page.domDeviceScaleFactor).toBe(2)
    expect(box.runtime.layout(tab)).toMatchObject({ revision: 2, viewport: page.domSize })
    await box.runtime.dispose()
  })

  it('verifies the actual CSS viewport before taking the same-layout fast path', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-same-layout' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.domSize = { width: 720, height: 773 }
    page.setViewportUpdatesDom = false

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'fit',
      viewport: { width: 720, height: 860 },
    })).resolves.toMatchObject({
      revision: 1,
      mode: 'fit',
      viewport: { width: 720, height: 860 },
      mediaGeneration: 1,
    })

    expect(page.domSize).toEqual({ width: 720, height: 860 })
    expect(box.cdpCommands.some((command) => command.method === 'Emulation.setDeviceMetricsOverride')).toBe(true)
    await box.runtime.dispose()
  })

  it('waits for a post-resize paint before publishing the committed viewport', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-painted' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')

    await box.runtime.proposeLayout(tab, {
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
    })

    expect(page.evaluations.at(-1)?.source).toBe('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await box.runtime.dispose()
  })

  it('reapplies an exact committed layout without advancing its media identity', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'verify-committed' }
    await box.runtime.ensure(tab, 'https://example.com')
    const committed = await box.runtime.proposeLayout(tab, {
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
    })
    const target = box.runtime.target(tab)
    const page = box.pages[0]
    if (target === undefined || page === undefined) throw new Error('missing fake target')
    page.domSize = { width: 720, height: 773 }
    page.setViewportUpdatesDom = false

    await expect(box.runtime.verifyLayout(tab, committed, target.identity)).resolves.toEqual(committed)

    expect(box.runtime.layout(tab)).toEqual(committed)
    expect(page.domSize).toEqual({ width: 1280, height: 800 })
    expect(box.cdpCommands.at(-1)).toMatchObject({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 1280, height: 800 },
    })
    await box.runtime.dispose()
  })

  it('closes the exact target and rejects the proposal when Chromium still violates the viewport postcondition', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-failed' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.setViewportUpdatesDom = false
    page.cdpOverrideUpdatesDom = false

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'tablet',
      viewport: { width: 768, height: 1024 },
    })).rejects.toThrow('did not apply')

    expect(page.closed).toBe(true)
    expect(box.closed.sessions).toBe(1)
    expect(box.runtime.target(tab)).toBeUndefined()
    expect(box.runtime.layout(tab)).toBeUndefined()
    await box.runtime.dispose()
  })

  it('closes the exact target when the CDP viewport fallback fails', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-cdp-failed' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.setViewportUpdatesDom = false
    page.cdpOverrideError = new Error('CDP override failed')

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'phone',
      viewport: { width: 390, height: 844 },
    })).rejects.toThrow('CDP override failed')

    expect(page.closed).toBe(true)
    expect(box.runtime.target(tab)).toBeUndefined()
    await box.runtime.dispose()
  })

  it('closes the exact target when same-layout postcondition evaluation fails', async () => {
    const box = harness()
    const tab = { sessionId: 'layout', tabId: 'postcondition-evaluate-failed' }
    await box.runtime.ensure(tab, 'https://example.com')
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing fake Page')
    page.cssViewportError = new Error('viewport evaluation failed')

    await expect(box.runtime.proposeLayout(tab, {
      mode: 'fit',
      viewport: { width: 720, height: 860 },
    })).rejects.toThrow('viewport evaluation failed')

    expect(page.closed).toBe(true)
    expect(box.runtime.target(tab)).toBeUndefined()
    await box.runtime.dispose()
  })

  it('does not reap a Page while an exact media owner holds a lease', async () => {
    let now = 0
    const box = harness({ now: () => now, idleMs: 10 })
    const tab = { sessionId: 'lease', tabId: 'page' }
    await box.runtime.ensure(tab, 'https://example.com')
    const release = box.runtime.acquire(tab)
    now = 100
    await box.runtime.reap()
    expect(box.pages[0]?.closed).toBe(false)
    release()
    await box.runtime.reap()
    expect(box.pages[0]?.closed).toBe(true)
    await box.runtime.dispose()
  })

  it('opens public https pages and drives document-scoped refs', async () => {
    const box = harness()
    const tab = { sessionId: 's1', tabId: 'browser-1' }

    await expect(box.runtime.ensure(tab, 'https://example.com/external')).resolves.toMatchObject({
      url: 'https://example.com/external',
      title: 'External',
      status: 'ready',
      documentId: 's1:browser-1:d1',
    })
    const snapshot = await box.runtime.snapshot(tab)
    expect(snapshot).toMatchObject({
      url: 'https://example.com/external',
      driveable: true,
      documentId: 's1:browser-1:d1',
      nodes: [{ ref: '@d1e1', role: 'button', name: 'Save', selector: '#save' }],
    })
    expect(await box.runtime.click(tab, '@d1e1')).toEqual({ ok: true })
    expect(await box.runtime.fill(tab, '@d1e1', 'draft')).toEqual({ ok: true })
    expect(box.pages[0]?.clicked).toEqual(['#save'])
    expect(box.pages[0]?.filled).toEqual([{ selector: '#save', text: 'draft' }])

    await box.runtime.ensure(tab, 'https://example.com/next')
    expect(await box.runtime.click(tab, '@d1e1')).toMatchObject({ ok: false, code: 'stale-ref' })
    expect(await box.runtime.click(tab, 'save')).toMatchObject({ ok: false, code: 'unknown-ref' })
    await box.runtime.dispose()
  })



  it('outlines non-interactive page elements and captures the same selector', async () => {
    class OutlinePage extends FakePage {
      override async evaluate<T>(expression?: string): Promise<T> {
        if (expression?.includes('document.querySelector("#logo")')) {
          return { x: 300, y: 84, w: 120, h: 45 } as T
        }
        if (expression?.includes("querySelectorAll('*')")) {
          return [{ role: 'image', name: 'Baidu logo', selector: '#logo', rect: { x: 300, y: 120, w: 120, h: 45 } }] as T
        }
        return super.evaluate<T>()
      }
    }
    const page = new OutlinePage()
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-outline-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'outline', tabId: 'browser' }
    await runtime.ensure(tab, 'https://example.com')
    await expect(runtime.outline(tab)).resolves.toMatchObject({
      documentId: 'outline:browser:d1',
      nodes: [{ role: 'image', name: 'Baidu logo', selector: '#logo' }],
    })
    await expect(runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({
      nodes: [{ role: 'image', name: 'Baidu logo', selector: '#logo' }],
    })
    await expect(runtime.trackRect(tab, '#logo')).resolves.toEqual({
      documentId: 'outline:browser:d1', selector: '#logo', rect: { x: 300, y: 84, w: 120, h: 45 },
    })
    await runtime.dispose()
  })

  it.each(['outline', 'trackRect'] as const)('rejects a stale exact target after async %s work when the Tab has a replacement Page', async (operation) => {
    const box = harness()
    const tab = { sessionId: 'exact-async', tabId: operation }
    await box.runtime.ensure(tab, 'https://one.example')
    const target = box.runtime.target(tab)
    const firstPage = box.pages[0]
    if (target === undefined || firstPage === undefined) throw new Error('missing first target')
    let resume!: () => void
    let started!: () => void
    const evaluationStarted = new Promise<void>((resolve) => { started = resolve })
    const evaluationGate = new Promise<void>((resolve) => { resume = resolve })
    firstPage.onEvaluate = async () => {
      started()
      await evaluationGate
    }

    const pending = operation === 'outline'
      ? box.runtime.outline(tab, target.identity)
      : box.runtime.trackRect(tab, '#save', target.identity)
    await evaluationStarted
    await box.runtime.close(tab)
    await box.runtime.ensure(tab, 'https://two.example')
    resume()

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'not-ready' })
    expect(box.runtime.target(tab)?.identity).not.toBe(target.identity)
    await box.runtime.dispose()
  })

  it('captures one exact viewport image with the current nodes', async () => {
    const box = harness()
    const tab = { sessionId: 's2', tabId: 'browser-2' }
    await box.runtime.ensure(tab, 'https://example.com')

    await expect(box.runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({
      captureId: 's2:browser-2:d1:c1',
      documentId: 's2:browser-2:d1',
      mediaType: 'image/jpeg',
      width: 720,
      height: 860,
      image: new Uint8Array([1, 2, 3]),
      nodes: [{ ref: '@d1o1', selector: '#save' }],
    })
    await box.runtime.dispose()
  })

  it('keeps Pages alive until their Tab closes and closes the context on dispose', async () => {
    const box = harness()
    const first = { sessionId: 's3', tabId: 'a' }
    const second = { sessionId: 's3', tabId: 'b' }
    await box.runtime.ensure(first, 'https://one.example')
    await box.runtime.ensure(second, 'https://two.example')
    expect(box.pages).toHaveLength(2)

    await box.runtime.close(first)
    expect(box.pages[0]?.closed).toBe(true)
    expect(box.pages[1]?.closed).toBe(false)
    await box.runtime.dispose()
    expect(box.pages[1]?.closed).toBe(true)
    expect(box.closed.context).toBe(true)
    expect(box.closed.sessions).toBe(2)
  })

  it('relaunches Chromium after the persistent context exits', async () => {
    const contexts: Array<{ crash(): void }> = []
    const pages: FakePage[] = []
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-relaunch-' + Math.random().toString(36).slice(2),
      launch: async () => {
        let closed = false
        const closeHandlers: Array<() => void> = []
        const context = {
          async newPage() {
            if (closed) throw new Error('browserContext.newPage: Target page, context or browser has been closed')
            const page = new FakePage()
            pages.push(page)
            return page
          },
          async newCDPSession() {
            return { async send() {}, on() {}, off() {}, async detach() {} }
          },
          on(event: string, listener: () => void) { if (event === 'close') closeHandlers.push(listener) },
          async close() { closed = true; for (const listener of closeHandlers) listener() },
          crash() { closed = true; for (const listener of closeHandlers) listener() },
        }
        contexts.push(context)
        return context
      },
    })
    await runtime.ensure({ sessionId: 'relaunch', tabId: 'first' }, 'https://one.example')
    contexts[0]?.crash()
    await expect(runtime.ensure({ sessionId: 'relaunch', tabId: 'second' }, 'https://two.example')).resolves.toMatchObject({ status: 'ready' })
    expect(contexts).toHaveLength(2)
    expect(pages).toHaveLength(2)
    await runtime.dispose()
  })





  it('keeps Chromium font shared memory on /dev/shm and uses a dense viewport', async () => {
    let ignored: string[] | undefined
    let scale: number | undefined
    let args: string[] | undefined
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-shm-' + Math.random().toString(36).slice(2),
      launch: async (_profileDir, options) => {
        ignored = (options as { ignoreDefaultArgs?: string[] }).ignoreDefaultArgs
        scale = (options as { deviceScaleFactor?: number }).deviceScaleFactor
        args = (options as { args?: string[] }).args
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await runtime.ensure({ sessionId: 'shm', tabId: 'tab' }, 'https://example.com')
    expect(ignored).toContain('--disable-dev-shm-usage')
    expect(ignored).toContain('--disable-background-timer-throttling')
    expect(ignored).toContain('--disable-backgrounding-occluded-windows')
    expect(ignored).toContain('--disable-renderer-backgrounding')
    expect(scale).toBe(2)
    expect(MANAGED_BROWSER_CACHE_BUDGET_BYTES).toBe(256 * 1024 * 1024)
    expect(args).toContain('--disk-cache-size=' + MANAGED_BROWSER_CACHE_BUDGET_BYTES)
    expect(args).toContain('--media-cache-size=' + MANAGED_BROWSER_CACHE_BUDGET_BYTES)
    await runtime.dispose()
  })

  it('clears Browser cache once through CDP only after an over-budget context launches', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-clear-'))
    const cacheDir = join(profileDir, 'Default', 'Cache')
    await mkdir(cacheDir, { recursive: true })
    await mkdir(join(profileDir, 'Default', 'Local Storage'), { recursive: true })
    await mkdir(join(profileDir, 'Default', 'IndexedDB'), { recursive: true })
    await writeFile(join(cacheDir, 'data'), '12345678')
    await writeFile(join(profileDir, 'Default', 'Cookies'), 'cookie')
    await writeFile(join(profileDir, 'Default', 'Local Storage', 'keep'), 'storage')
    await writeFile(join(profileDir, 'Default', 'IndexedDB', 'keep'), 'database')
    const box = cacheContext(true)
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      launch: async () => box.context,
    })
    await expect(runtime.ensure({ sessionId: 'cache-clear', tabId: 'tab' }, 'https://example.com')).resolves.toMatchObject({ status: 'ready' })
    await expect(runtime.ensure({ sessionId: 'cache-clear', tabId: 'second' }, 'https://two.example')).resolves.toMatchObject({ status: 'ready' })
    expect(box.cacheCommands).toEqual(['Network.enable', 'Network.clearBrowserCache'])
    expect(box.observation.cacheDetached).toBe(true)
    expect(box.temporaryPage.closed).toBe(true)
    expect(box.managedPages).toHaveLength(2)
    await expect(readFile(join(cacheDir, 'data'), 'utf8')).resolves.toBe('12345678')
    await expect(readFile(join(profileDir, 'Default', 'Cookies'), 'utf8')).resolves.toBe('cookie')
    await expect(readFile(join(profileDir, 'Default', 'Local Storage', 'keep'), 'utf8')).resolves.toBe('storage')
    await expect(readFile(join(profileDir, 'Default', 'IndexedDB', 'keep'), 'utf8')).resolves.toBe('database')
    expect((await readdir(profileDir)).some((name) => name.startsWith('.dcs-'))).toBe(false)
    expect((await readdir(join(profileDir, 'Default'))).some((name) => name.startsWith('.dcs-'))).toBe(false)
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('closes a launched context promptly when dispose races a suspended cache clear', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-dispose-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    const temporaryPage = new FakePage()
    const closeHandlers: Array<() => void> = []
    let releaseClear!: () => void
    let clearStarted!: () => void
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve })
    const clearSuspended = new Promise<void>((resolve) => { clearStarted = resolve })
    let closeCalls = 0
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      launch: async () => ({
        async newPage() { return temporaryPage },
        async newCDPSession() {
          return {
            async send(method: string) {
              if (method !== 'Network.clearBrowserCache') return
              clearStarted()
              await clearGate
            },
            on() {}, off() {}, async detach() {},
          }
        },
        on(_event: 'close', listener: () => void) { closeHandlers.push(listener) },
        async close() {
          closeCalls += 1
          for (const listener of closeHandlers) listener()
        },
      }),
    })
    const opening = runtime.ensure({ sessionId: 'cache-dispose', tabId: 'tab' }, 'https://example.com')
    await clearSuspended

    await runtime.dispose()
    expect(closeCalls).toBe(1)
    expect(temporaryPage.closed).toBe(false)

    releaseClear()
    await expect(opening).rejects.toThrow(/disposed|closed/)
    await rm(profileDir, { recursive: true, force: true })
  })

  it('does not clear Browser cache when the read-only estimate is within budget', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-within-budget-'))
    const outside = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-outside-'))
    const cacheDir = join(profileDir, 'Default', 'Cache')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'data'), '1234')
    await writeFile(join(outside, 'large'), '12345678')
    await symlink(outside, join(profileDir, 'GPUCache'))
    const box = cacheContext(false)
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 4,
      launch: async () => box.context,
    })
    await runtime.ensure({ sessionId: 'cache-small', tabId: 'tab' }, 'https://example.com')
    expect(box.cacheCommands).toEqual([])
    expect(box.managedPages).toHaveLength(1)
    expect(box.temporaryPage.closed).toBe(false)
    expect((await readdir(profileDir)).some((name) => name.startsWith('.dcs-'))).toBe(false)
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('warns and keeps the launched context usable when Browser cache clear fails', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-clear-failure-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    const box = cacheContext(true, new Error('CDP clear failed'))
    const warnings: string[] = []
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      onWarning: (message) => { warnings.push(message) },
      launch: async () => box.context,
    })
    await expect(runtime.ensure({ sessionId: 'cache-failure', tabId: 'tab' }, 'https://example.com')).resolves.toMatchObject({ status: 'ready' })
    expect(box.cacheCommands).toEqual(['Network.enable', 'Network.clearBrowserCache'])
    expect(box.observation.cacheDetached).toBe(true)
    expect(box.temporaryPage.closed).toBe(true)
    expect(box.managedPages).toHaveLength(1)
    expect(warnings).toEqual([expect.stringContaining('Browser cache clear failed: CDP clear failed')])
    await runtime.dispose()
    expect(box.observation.contextClosed).toBe(true)
    await rm(profileDir, { recursive: true, force: true })
  })

  it('relaunches after the context exits while Browser cache cleanup is running', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-close-during-clear-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    const first = cacheContextThatClosesDuringClear()
    const second = cacheContext(true)
    const launchContexts = [first.context, second.context]
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      launch: async () => {
        const context = launchContexts.shift()
        if (context === undefined) throw new Error('unexpected extra launch')
        return context
      },
    })

    await expect(runtime.ensure({ sessionId: 'cache-close', tabId: 'first' }, 'https://one.example')).rejects.toThrow('closed')
    await expect(runtime.ensure({ sessionId: 'cache-close', tabId: 'second' }, 'https://two.example')).resolves.toMatchObject({ status: 'ready' })
    expect(first.cacheCommands).toEqual(['Network.enable', 'Network.clearBrowserCache'])
    expect(first.temporaryPage.closed).toBe(true)
    expect(second.cacheCommands).toEqual(['Network.enable', 'Network.clearBrowserCache'])
    expect(second.managedPages).toHaveLength(1)

    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('lets Chromium choose one shared-profile winner and only that context clears cache', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-browser-cache-concurrent-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    const winner = cacheContext(true)
    let profileOwned = false
    let launchCalls = 0
    const launch = async () => {
      launchCalls += 1
      if (profileOwned) throw new Error('Chromium profile is already in use')
      profileOwned = true
      return winner.context
    }
    const first = new ManagedBrowserRuntime({ executablePath: '/bin/true', profileDir, cacheBudgetBytes: 1, launch })
    const second = new ManagedBrowserRuntime({ executablePath: '/bin/true', profileDir, cacheBudgetBytes: 1, launch })
    const results = await Promise.allSettled([
      first.ensure({ sessionId: 'concurrent', tabId: 'first' }, 'https://one.example'),
      second.ensure({ sessionId: 'concurrent', tabId: 'second' }, 'https://two.example'),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(launchCalls).toBe(2)
    expect(winner.cacheCommands).toEqual(['Network.enable', 'Network.clearBrowserCache'])
    expect(winner.temporaryPage.closed).toBe(true)
    expect((await readdir(profileDir)).some((name) => name.startsWith('.dcs-'))).toBe(false)
    await Promise.all([first.dispose(), second.dispose()])
    await rm(profileDir, { recursive: true, force: true })
  })

  it('keeps the stream target while a public page is still navigating', async () => {
    const box = harness()
    const tab = { sessionId: 'gh', tabId: 'browser' }
    await box.runtime.ensure(tab, 'https://github.com/NOirBRi')
    expect(box.runtime.target(tab)).toBeDefined()
    const page = box.pages[0]
    if (page === undefined) throw new Error('missing page')
    page.currentUrl = 'https://github.com/NOirBRi?tab=repositories'
    page.emit('framenavigated', page.frame)
    expect(box.runtime.projection(tab)?.status).toBe('loading')
    expect(box.runtime.target(tab)).toBeDefined()
    await box.runtime.dispose()
  })

  it('does not spawn a Page for the DSH web GUI itself', async () => {
    const box = harness()
    await expect(box.runtime.ensure({ sessionId: 'nest', tabId: 'b' }, 'http://127.0.0.1:3080/')).resolves.toMatchObject({
      status: 'error',
      url: 'http://127.0.0.1:3080/',
    })
    expect(box.pages).toHaveLength(0)
    await box.runtime.dispose()
  })

  it('stops a Cloudflare challenge page instead of leaving PoW running', async () => {
    class ChallengePage extends FakePage {
      override async goto(url: string): Promise<void> {
        this.history.push(this.currentUrl)
        this.currentUrl = url
        this.currentTitle = url.includes('chatgpt.com') ? 'Just a moment...' : ''
        this.emit('framenavigated', this.frame)
      }
    }
    const page = new ChallengePage()
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-cf-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    await expect(runtime.ensure({ sessionId: 'cf', tabId: 'b' }, 'https://chatgpt.com/codex/settings/usage')).resolves.toMatchObject({
      status: 'error',
    })
    expect(page.currentUrl).toBe('about:blank')
    await runtime.dispose()
  })

  it('closes every Page for one session and evicts idle overflow Pages', async () => {
    let now = 1_000
    const box = harness({ now: () => now, maxLivePages: 2, idleMs: 50 })
    await box.runtime.ensure({ sessionId: 's1', tabId: 'a' }, 'https://one.example')
    await box.runtime.ensure({ sessionId: 's2', tabId: 'a' }, 'https://two.example')
    await box.runtime.closeSession('s1')
    expect(box.pages[0]?.closed).toBe(true)
    expect(box.pages[1]?.closed).toBe(false)

    now = 1_020
    await box.runtime.ensure({ sessionId: 's3', tabId: 'a' }, 'https://three.example')
    await box.runtime.ensure({ sessionId: 's4', tabId: 'a' }, 'https://four.example')
    expect(box.pages.filter((page) => !page.closed)).toHaveLength(2)
    expect(box.pages[1]?.closed).toBe(true)
    await box.runtime.dispose()
  })

  it('prefers an installed Playwright Chromium over system Chrome', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'dcs-playwright-cache-'))
    const executable = join(cacheRoot, 'chromium-1223', 'chrome-linux64', 'chrome')
    await mkdir(join(cacheRoot, 'chromium-1223', 'chrome-linux64'), { recursive: true })
    await writeFile(executable, '#!/bin/sh\n')
    await chmod(executable, 0o755)
    const previousCache = process.env.PLAYWRIGHT_BROWSERS_PATH
    const previousExplicit = process.env.DSH_CODEX_BROWSER_EXECUTABLE
    process.env.PLAYWRIGHT_BROWSERS_PATH = cacheRoot
    delete process.env.DSH_CODEX_BROWSER_EXECUTABLE
    try {
      await expect(findBrowserExecutable()).resolves.toBe(executable)
    } finally {
      if (previousCache === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousCache
      if (previousExplicit === undefined) delete process.env.DSH_CODEX_BROWSER_EXECUTABLE
      else process.env.DSH_CODEX_BROWSER_EXECUTABLE = previousExplicit
      await rm(cacheRoot, { recursive: true, force: true })
    }
  })

  it('keeps the requested http URL when Chromium lands on chrome-error://', async () => {
    class DeadPage extends FakePage {
      override async goto(url: string): Promise<void> {
        this.history.push(this.currentUrl)
        this.currentUrl = 'chrome-error://chromewebdata/'
        this.currentTitle = ''
        this.emit('framenavigated', this.frame)
        throw new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${url}`)
      }

      override async reload(): Promise<void> {
        throw new Error('reload should not retry chrome-error://')
      }
    }
    const page = new DeadPage()
    let ensured = 0
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-chrome-error-' + Math.random().toString(36).slice(2),
      launch: async () => ({
        async newPage() { return page },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }),
    })
    const tab = { sessionId: 'dead', tabId: 'browser' }
    const url = 'http://127.0.0.1:4187/index.html'
    await expect(runtime.ensure(tab, url)).resolves.toMatchObject({
      url,
      status: 'error',
    })
    expect(page.currentUrl).toBe('chrome-error://chromewebdata/')
    page.goto = async (next: string) => {
      ensured += 1
      page.currentUrl = next
      page.currentTitle = 'ok'
      page.emit('framenavigated', page.frame)
    }
    await expect(runtime.reload(tab)).resolves.toMatchObject({ url, status: 'ready' })
    expect(ensured).toBe(1)
    await runtime.dispose()
  })


})
