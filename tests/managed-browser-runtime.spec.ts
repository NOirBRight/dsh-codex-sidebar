import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanupDerivedChromiumCaches, findBrowserExecutable, MANAGED_BROWSER_CACHE_BUDGET_BYTES, ManagedBrowserRuntime, reclaimProfileInitializationLease } from '../src/managed-browser-runtime.ts'

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

  it('removes only allowlisted derived caches over budget before launch without following symlinks', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-cache-budget-'))
    const outside = await mkdtemp(join(tmpdir(), 'dcs-cache-outside-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await mkdir(join(profileDir, 'Default', 'Code Cache'), { recursive: true })
    await mkdir(join(profileDir, 'Default', 'Local Storage'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    await writeFile(join(profileDir, 'Default', 'Code Cache', 'code'), 'abcdefgh')
    await writeFile(join(profileDir, 'Default', 'Local Storage', 'keep'), 'storage')
    await writeFile(join(profileDir, 'Default', 'Cookies'), 'cookie')
    await writeFile(join(outside, 'keep'), 'outside')
    await symlink(outside, join(profileDir, 'GPUCache'))
    let cacheAtLaunch = true
    let storageAtLaunch = false
    let cookieAtLaunch = false
    let symlinkAtLaunch = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 10,
      launch: async () => {
        cacheAtLaunch = await lstat(join(profileDir, 'Default', 'Cache')).then(() => true, () => false)
        storageAtLaunch = await readFile(join(profileDir, 'Default', 'Local Storage', 'keep'), 'utf8').then((value) => value === 'storage', () => false)
        cookieAtLaunch = await readFile(join(profileDir, 'Default', 'Cookies'), 'utf8').then((value) => value === 'cookie', () => false)
        symlinkAtLaunch = await lstat(join(profileDir, 'GPUCache')).then((value) => value.isSymbolicLink(), () => false)
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await runtime.ensure({ sessionId: 'cache', tabId: 'tab' }, 'https://example.com')
    expect(cacheAtLaunch).toBe(false)
    expect(storageAtLaunch).toBe(true)
    expect(cookieAtLaunch).toBe(true)
    expect(symlinkAtLaunch).toBe(true)
    await expect(readFile(join(outside, 'keep'), 'utf8')).resolves.toBe('outside')
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('does not clean or launch while another Chromium singleton is live', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-live-cache-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    await symlink(hostname() + '-' + process.pid, join(profileDir, 'SingletonLock'))
    let cacheAtLaunch = false
    let launched = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      launch: async () => {
        launched = true
        cacheAtLaunch = await lstat(join(profileDir, 'Default', 'Cache')).then(() => true, () => false)
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await expect(runtime.ensure({ sessionId: 'live-cache', tabId: 'tab' }, 'https://example.com')).rejects.toThrow('Chromium profile is already in use')
    expect(launched).toBe(false)
    expect(cacheAtLaunch).toBe(false)
    await expect(readFile(join(profileDir, 'Default', 'Cache', 'data'), 'utf8')).resolves.toBe('12345678')
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('serializes initialization and launch for concurrent runtimes sharing one profile', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-profile-lease-'))
    let launchCalls = 0
    let activeLaunches = 0
    let maxActiveLaunches = 0
    let releaseFirst: (() => void) | undefined
    const launch = async () => {
      launchCalls += 1
      activeLaunches += 1
      maxActiveLaunches = Math.max(maxActiveLaunches, activeLaunches)
      if (launchCalls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve })
      activeLaunches -= 1
      return {
        async newPage() { return new FakePage() },
        async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
        on() {},
        async close() {},
      }
    }
    const first = new ManagedBrowserRuntime({ executablePath: '/bin/true', profileDir, launch })
    const second = new ManagedBrowserRuntime({ executablePath: '/bin/true', profileDir, launch })
    const firstEnsure = first.ensure({ sessionId: 'lease', tabId: 'first' }, 'https://one.example')
    await vi.waitFor(() => { expect(launchCalls).toBe(1) })
    const secondEnsure = second.ensure({ sessionId: 'lease', tabId: 'second' }, 'https://two.example')
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    const callsBeforeRelease = launchCalls
    releaseFirst?.()
    await Promise.all([firstEnsure, secondEnsure])
    expect(callsBeforeRelease).toBe(1)
    expect(maxActiveLaunches).toBe(1)
    await Promise.all([first.dispose(), second.dispose()])
    await rm(profileDir, { recursive: true, force: true })
  })

  it('revalidates singleton state after cache traversal and before deletion', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-cache-race-'))
    const cacheDir = join(profileDir, 'Default', 'Cache')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'data'), '12345678')
    let revalidated = 0
    await cleanupDerivedChromiumCaches(profileDir, 1, async () => {
      revalidated += 1
      await symlink(hostname() + '-' + process.pid, join(profileDir, 'SingletonLock'))
      return false
    })
    expect(revalidated).toBe(1)
    await expect(readFile(join(cacheDir, 'data'), 'utf8')).resolves.toBe('12345678')
    await rm(profileDir, { recursive: true, force: true })
  })

  it('keeps a detached cache quarantine when a Chromium singleton appears before recursive deletion', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-cache-quarantine-race-'))
    const cacheParent = join(profileDir, 'Default')
    const cacheDir = join(cacheParent, 'Cache')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'data'), '12345678')
    let ownershipChecks = 0
    await cleanupDerivedChromiumCaches(profileDir, 1, async () => {
      ownershipChecks += 1
      if (ownershipChecks === 1) return true
      await mkdir(cacheDir)
      await writeFile(join(cacheDir, 'active'), 'current Chromium cache')
      await symlink(hostname() + '-' + process.pid, join(profileDir, 'SingletonLock'))
      return false
    })
    const quarantines = (await readdir(cacheParent)).filter((name) => name.startsWith('.dcs-cache-quarantine-'))
    expect(ownershipChecks).toBe(2)
    expect(quarantines).toHaveLength(1)
    const quarantine = quarantines[0]
    if (quarantine === undefined) throw new Error('missing detached cache quarantine')
    await expect(readFile(join(cacheParent, quarantine, 'data'), 'utf8')).resolves.toBe('12345678')
    await expect(readFile(join(cacheDir, 'active'), 'utf8')).resolves.toBe('current Chromium cache')
    await expect(readlink(join(profileDir, 'SingletonLock'))).resolves.toBe(hostname() + '-' + process.pid)
    await rm(profileDir, { recursive: true, force: true })
  })

  it('does not clean caches when singleton ownership cannot be proven stale', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-opaque-singleton-'))
    await mkdir(join(profileDir, 'Default', 'Cache'), { recursive: true })
    await writeFile(join(profileDir, 'Default', 'Cache', 'data'), '12345678')
    await writeFile(join(profileDir, 'SingletonLock'), 'opaque owner')
    let launched = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      launch: async () => {
        launched = true
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await expect(runtime.ensure({ sessionId: 'opaque-cache', tabId: 'tab' }, 'https://example.com')).rejects.toThrow('Chromium profile is already in use')
    expect(launched).toBe(false)
    await expect(readFile(join(profileDir, 'Default', 'Cache', 'data'), 'utf8')).resolves.toBe('12345678')
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('preserves a live SingletonLock that replaces stale ownership after the initial check', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-singleton-replacement-'))
    const singletonLock = join(profileDir, 'SingletonLock')
    await symlink(hostname() + '-2147483646', singletonLock)
    let launched = false
    let ownershipAfterReplacement = true
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cleanupDerivedCaches: async (_profileDir, _budgetBytes, mayDelete) => {
        await rm(singletonLock)
        await symlink(hostname() + '-' + process.pid, singletonLock)
        ownershipAfterReplacement = await mayDelete()
      },
      launch: async () => {
        launched = true
        throw new Error('must not launch')
      },
    })
    await expect(runtime.ensure({ sessionId: 'singleton-race', tabId: 'tab' }, 'https://example.com')).rejects.toThrow('Chromium profile is already in use')
    expect(ownershipAfterReplacement).toBe(false)
    expect(launched).toBe(false)
    await expect(readlink(singletonLock)).resolves.toBe(hostname() + '-' + process.pid)
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('warns and continues launching when derived-cache cleanup fails', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-cache-warning-'))
    const warnings: string[] = []
    let launched = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      cacheBudgetBytes: 1,
      onWarning: (message) => { warnings.push(message) },
      cleanupDerivedCaches: async () => { throw new Error('read-only cache') },
      launch: async () => {
        launched = true
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    try {
      await runtime.ensure({ sessionId: 'cache-warning', tabId: 'tab' }, 'https://example.com')
      expect(launched).toBe(true)
      expect(warnings).toEqual([expect.stringContaining('cache cleanup failed')])
      await runtime.dispose()
    } finally {
      await rm(profileDir, { recursive: true, force: true })
    }
  })

  it('does not discard a launched context when profile lease release fails', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-lease-release-failure-'))
    const warnings: string[] = []
    let closed = false
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      onWarning: (message) => { warnings.push(message) },
      launch: async () => {
        await chmod(profileDir, 0o500)
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() { closed = true },
        }
      },
    })
    try {
      await expect(runtime.ensure({ sessionId: 'release', tabId: 'tab' }, 'https://example.com')).resolves.toMatchObject({ status: 'ready' })
      expect(warnings.some((message) => message.includes('profile initialization lease release failed'))).toBe(true)
    } finally {
      await chmod(profileDir, 0o700)
      await runtime.dispose()
      await rm(profileDir, { recursive: true, force: true })
    }
    expect(closed).toBe(true)
  })

  it.each(['orphan', 'corrupt', 'dead-owner'] as const)('recovers an expired %s profile initialization lease', async (kind) => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-expired-lease-'))
    const leaseDir = join(profileDir, '.dcs-profile-initialization')
    await mkdir(leaseDir)
    const ownerPath = join(leaseDir, 'owner.json')
    if (kind === 'corrupt') await writeFile(ownerPath, '{not-json')
    if (kind === 'dead-owner') {
      await writeFile(ownerPath, JSON.stringify({ token: 'expired', hostname: hostname(), pid: 2147483646, createdAt: Date.now() - 60_000 }))
    }
    const expired = new Date(Date.now() - 60_000)
    await utimes(leaseDir, expired, expired)
    if (kind !== 'orphan') await utimes(ownerPath, expired, expired)
    const box = harness({ profileDir, profileLeaseTimeoutMs: 250 })
    await expect(box.runtime.ensure({ sessionId: kind, tabId: 'tab' }, 'https://example.com')).resolves.toMatchObject({ status: 'ready' })
    await box.runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
  })

  it('does not reclaim a replacement lease whose directory identity changed after inspection', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-replaced-lease-'))
    const leaseDir = join(profileDir, '.dcs-profile-initialization')
    await mkdir(leaseDir)
    const inspected = await lstat(leaseDir)
    await rm(leaseDir, { recursive: true })
    await mkdir(leaseDir)
    await writeFile(join(leaseDir, 'owner.json'), JSON.stringify({ token: 'new', hostname: hostname(), pid: process.pid, createdAt: Date.now() }))
    const reclaimed = await reclaimProfileInitializationLease(leaseDir, { dev: inspected.dev, ino: inspected.ino })
    expect(reclaimed).toBe(false)
    await expect(readFile(join(leaseDir, 'owner.json'), 'utf8')).resolves.toContain('"token":"new"')
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

  it('leaves a dead Chromium singleton for Chromium to arbitrate without unlinking it', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-stale-chromium-'))
    await symlink(hostname() + '-2147483646', join(profileDir, 'SingletonLock'))
    await symlink('/tmp/dcs-stale-singleton/socket', join(profileDir, 'SingletonSocket'))
    await symlink('stale-cookie', join(profileDir, 'SingletonCookie'))
    let staleAtLaunch = false
    let staleOwnerAtLaunch = ''
    const runtime = new ManagedBrowserRuntime({
      executablePath: '/bin/true',
      profileDir,
      launch: async () => {
        staleAtLaunch = await lstat(join(profileDir, 'SingletonLock')).then(() => true, () => false)
        staleOwnerAtLaunch = await readlink(join(profileDir, 'SingletonLock'))
        return {
          async newPage() { return new FakePage() },
          async newCDPSession() { return { async send() {}, on() {}, off() {}, async detach() {} } },
          on() {},
          async close() {},
        }
      },
    })
    await runtime.ensure({ sessionId: 'stale', tabId: 'tab' }, 'https://example.com')
    expect(staleAtLaunch).toBe(true)
    expect(staleOwnerAtLaunch).toBe(hostname() + '-2147483646')
    await runtime.dispose()
    await rm(profileDir, { recursive: true, force: true })
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
