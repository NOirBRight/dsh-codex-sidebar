import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findBrowserExecutable, MANAGED_BROWSER_CACHE_BUDGET_BYTES, ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

class FakePage {
  currentUrl = 'about:blank'
  currentTitle = 'Blank'
  closed = false
  clicked: string[] = []
  filled: Array<{ selector: string; text: string }> = []
  size = { width: 720, height: 860 }
  history: string[] = []
  resizeCalls: Array<{ width: number; height: number }> = []
  resizeReleases: Array<() => void> = []
  blockResizes = false
  handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  frame = { url: () => this.currentUrl }
  exposedBindings: Array<{ name: string; callback: (source: unknown, payload: unknown) => void }> = []
  evaluations: Array<{ source: string; argument: unknown }> = []
  onEvaluate: (() => void | Promise<void>) | undefined
  onScreenshot: (() => void | Promise<void>) | undefined

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
  isClosed(): boolean { return this.closed }
  url(): string { return this.currentUrl }
  async title(): Promise<string> { return this.currentTitle }
  viewportSize(): { width: number; height: number } { return this.size }
  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    this.resizeCalls.push(size)
    if (this.blockResizes) await new Promise<void>((resolve) => { this.resizeReleases.push(resolve) })
    this.size = size
  }
  async evaluate<T>(source?: string, argument?: unknown): Promise<T> {
    if (source !== undefined) this.evaluations.push({ source, argument })
    await this.onEvaluate?.()
    return [{ role: 'button', name: 'Save', selector: '#save', rect: { x: 10, y: 20, w: 80, h: 30 } }] as T
  }
  async exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void> {
    this.exposedBindings.push({ name, callback })
  }
  async screenshot(): Promise<Uint8Array> { await this.onScreenshot?.(); return new Uint8Array([1, 2, 3]) }
  locator(selector: string): { click(): Promise<void>; fill(text: string): Promise<void> } {
    return {
      click: async () => { this.clicked.push(selector) },
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
  closed: { context: boolean; sessions: number }
} {
  const pages: FakePage[] = []
  const closed = { context: false, sessions: 0 }
  const runtime = new ManagedBrowserRuntime({
    executablePath: '/bin/true',
    profileDir: '/tmp/dcs-managed-runtime-test-' + Math.random().toString(36).slice(2),
    launch: async () => ({
      async newPage() {
        const page = new FakePage()
        pages.push(page)
        return page
      },
      async newCDPSession() {
        return {
          async send() {},
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
  return { runtime, pages, closed }
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
