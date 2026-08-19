import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findBrowserExecutable, ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

class FakePage {
  currentUrl = 'about:blank'
  currentTitle = 'Blank'
  closed = false
  clicked: string[] = []
  filled: Array<{ selector: string; text: string }> = []
  size = { width: 720, height: 860 }
  history: string[] = []
  handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  frame = { url: () => this.currentUrl }

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
  async setViewportSize(size: { width: number; height: number }): Promise<void> { this.size = size }
  async evaluate<T>(): Promise<T> {
    return [{ role: 'button', name: 'Save', selector: '#save', rect: { x: 10, y: 20, w: 80, h: 30 } }] as T
  }
  async screenshot(): Promise<Uint8Array> { return new Uint8Array([1, 2, 3]) }
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

function harness(): {
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
  })
  return { runtime, pages, closed }
}

describe('ManagedBrowserRuntime', () => {
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
    await expect(runtime.capture(tab)).resolves.toMatchObject({
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

    await expect(box.runtime.capture(tab)).resolves.toMatchObject({
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





  it('keeps Chromium font shared memory on /dev/shm', async () => {
    let ignored: string[] | undefined
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir: '/tmp/dcs-managed-runtime-shm-' + Math.random().toString(36).slice(2),
      launch: async (_profileDir, options) => {
        ignored = (options as { ignoreDefaultArgs?: string[] }).ignoreDefaultArgs
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
    await runtime.dispose()
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

  it('removes a dead Chromium singleton before relaunching the persistent profile', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-stale-chromium-'))
    await symlink(hostname() + '-2147483646', join(profileDir, 'SingletonLock'))
    await symlink('/tmp/dcs-stale-singleton/socket', join(profileDir, 'SingletonSocket'))
    await symlink('stale-cookie', join(profileDir, 'SingletonCookie'))
    let staleAtLaunch = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      launch: async () => {
        staleAtLaunch = await lstat(join(profileDir, 'SingletonLock')).then(() => true, () => false)
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await runtime.ensure({ sessionId: 'stale', tabId: 'tab' }, 'https://example.com')
    expect(staleAtLaunch).toBe(false)
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })


})
