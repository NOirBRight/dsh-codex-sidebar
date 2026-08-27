/** One Host-managed Chromium runtime for every Browser Tab. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readlink, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { CHALLENGE_BLOCK_MESSAGE, harnessSelfBlockReason, isChallengePage } from './browser-guard.ts'
import { isChromiumErrorUrl, liveHref } from './browser.ts'
import type { DriveNode, DriveSnapshot } from './browser-drive.ts'

export const MANAGED_BROWSER_MAX_LIVE_PAGES = 3
export const MANAGED_BROWSER_IDLE_MS = 120_000
export const MANAGED_BROWSER_CACHE_BUDGET_BYTES = 256 * 1024 * 1024
export const PLAYWRIGHT_IGNORE_DEFAULT_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]

export type ManagedTabKey = { sessionId: string; tabId: string }

export type ManagedBrowserConfig = {
  executablePath?: string
  profileDir?: string
  headless?: boolean
  /** Maximum total bytes retained in allowlisted Chromium-derived cache directories. */
  cacheBudgetBytes?: number
}

export type ManagedBrowserStatus = 'idle' | 'loading' | 'ready' | 'error' | 'crashed'

export type ManagedBrowserProjection = {
  key: string
  sessionId: string
  tabId: string
  url: string
  title: string
  documentId: string
  status: ManagedBrowserStatus
  error?: string
}

export type ManagedBrowserActionResult =
  | { ok: true }
  | { ok: false; code: 'not-ready' | 'stale-ref' | 'unknown-ref' | 'navigation-failed'; message: string }

export type ManagedBrowserOutline = {
  documentId: string
  nodes: DriveNode[]
}

export type ManagedBrowserTrackedRect = {
  documentId: string
  selector: string
  rect: { x: number; y: number; w: number; h: number } | null
}

export type ManagedBrowserCapture = {
  captureId: string
  documentId: string
  url: string
  title: string
  image: Uint8Array
  mediaType: 'image/jpeg'
  width: number
  height: number
  nodes: DriveNode[]
}

type LocatorLike = {
  click(): Promise<void>
  fill(text: string): Promise<void>
}

type FrameLike = { url(): string }

type PageLike = {
  goto(url: string, opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  goBack(opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  goForward(opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  reload(opts?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  close(): Promise<void>
  isClosed(): boolean
  url(): string
  title(): Promise<string>
  viewportSize(): { width: number; height: number } | null
  setViewportSize(size: { width: number; height: number }): Promise<void>
  evaluate<R>(expression: string): Promise<R>
  screenshot(opts: { type: 'jpeg'; quality: number }): Promise<Uint8Array>
  locator(selector: string): LocatorLike
  mainFrame(): FrameLike
  on(event: 'framenavigated', listener: (frame: FrameLike) => void): void
  on(event: 'close' | 'crash' | 'domcontentloaded', listener: () => void): void
  on(event: 'popup', listener: (page: PageLike) => void): void
}

export type ManagedCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: string, listener: (payload: unknown) => void): void
  off(event: string, listener: (payload: unknown) => void): void
  detach(): Promise<void>
}

type ContextLike = {
  newPage(): Promise<PageLike>
  newCDPSession(page: PageLike): Promise<ManagedCdpSession>
  on(event: 'close', listener: () => void): void
  close(): Promise<void>
}

type LaunchContext = (profileDir: string, opts: {
  executablePath: string
  headless: boolean
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  ignoreDefaultArgs: string[]
  args: string[]
}) => Promise<ContextLike>

type CacheCleanup = (
  profileDir: string,
  budgetBytes: number,
  mayDelete: () => Promise<boolean>,
) => Promise<void>

export type ManagedBrowserRuntimeOptions = ManagedBrowserConfig & {
  launch?: LaunchContext
  onProjection?: (projection: ManagedBrowserProjection) => void
  onPopup?: (opener: ManagedTabKey, page: unknown) => void
  now?: () => number
  maxLivePages?: number
  idleMs?: number
  onWarning?: (message: string) => void
  cleanupDerivedCaches?: CacheCleanup
  profileLeaseTimeoutMs?: number
}

type RefTarget = { documentId: string; selector: string }

type PageRecord = {
  tab: ManagedTabKey
  key: string
  page: PageLike
  cdp: ManagedCdpSession
  url: string
  title: string
  status: ManagedBrowserStatus
  documentSeq: number
  documentId: string
  refs: Map<string, RefTarget>
  error?: string
  command: Promise<void>
  lastAccess: number
  blocked?: boolean
}

const DEFAULT_VIEWPORT = Object.freeze({ width: 720, height: 860 })
const NAVIGATION_TIMEOUT_MS = 30_000
const EVIDENCE_QUALITY = 85
const DEFAULT_DEVICE_SCALE_FACTOR = 2

export class ManagedBrowserRuntime {
  readonly profileDir: string
  readonly headless: boolean
  #executablePath: string | undefined
  #launch: LaunchContext
  #context: Promise<ContextLike> | undefined
  #pages = new Map<string, PageRecord>()
  #requestedViewports = new Map<string, { width: number; height: number }>()
  #captureSeq = 0
  #onProjection: ((projection: ManagedBrowserProjection) => void) | undefined
  #onPopup: ((opener: ManagedTabKey, page: unknown) => void) | undefined
  #now: () => number
  #maxLivePages: number
  #idleMs: number
  #cacheBudgetBytes: number
  #onWarning: (message: string) => void
  #cleanupDerivedCaches: CacheCleanup
  #profileLeaseTimeoutMs: number
  #reaping = false

  constructor(opts: ManagedBrowserRuntimeOptions = {}) {
    this.profileDir = resolve(opts.profileDir ?? defaultProfileDir())
    this.headless = opts.headless ?? true
    this.#executablePath = opts.executablePath
    this.#launch = opts.launch ?? launchPlaywright
    this.#onProjection = opts.onProjection
    this.#onPopup = opts.onPopup
    this.#now = opts.now ?? Date.now
    this.#maxLivePages = opts.maxLivePages ?? MANAGED_BROWSER_MAX_LIVE_PAGES
    this.#idleMs = opts.idleMs ?? MANAGED_BROWSER_IDLE_MS
    this.#cacheBudgetBytes = cacheBudgetBytes(opts.cacheBudgetBytes)
    this.#onWarning = opts.onWarning ?? ((message) => { console.warn('[dsh-codex-sidebar] ' + message) })
    this.#cleanupDerivedCaches = opts.cleanupDerivedCaches ?? cleanupDerivedChromiumCaches
    this.#profileLeaseTimeoutMs = opts.profileLeaseTimeoutMs ?? PROFILE_INITIALIZATION_LEASE_TIMEOUT_MS
  }

  keyOf(tab: ManagedTabKey): string {
    return tab.sessionId + ':' + tab.tabId
  }

  list(): ManagedBrowserProjection[] {
    return [...this.#pages.values()].map((record) => project(record))
  }

  projection(tab: ManagedTabKey): ManagedBrowserProjection | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    return record === undefined ? undefined : project(record)
  }

  async ensure(tab: ManagedTabKey, url: string): Promise<ManagedBrowserProjection> {
    const blocked = harnessSelfBlockReason(url)
    if (blocked !== undefined) {
      if (this.#pages.has(this.keyOf(tab))) await this.close(tab)
      return {
        key: this.keyOf(tab),
        sessionId: tab.sessionId,
        tabId: tab.tabId,
        url,
        title: '',
        documentId: this.keyOf(tab) + ':blocked',
        status: 'error',
        error: blocked,
      }
    }
    const record = await this.#record(tab)
    if (record.status === 'ready' && record.page.url() === url) {
      this.#touch(record)
      await this.reap()
      return project(record)
    }
    await this.#enqueue(record, async () => {
      record.status = 'loading'
      record.url = url
      delete record.error
      delete record.blocked
      this.#publish(record)
      try {
        await record.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
        await this.#refresh(record)
      } catch (error) {
        this.#fail(record, error)
      }
    })
    this.#touch(record)
    await this.reap()
    return project(record)
  }

  async closeSession(sessionId: string): Promise<void> {
    const tabs = [...this.#pages.values()].filter((record) => record.tab.sessionId === sessionId).map((record) => record.tab)
    await Promise.all(tabs.map((tab) => this.close(tab)))
  }

  async reap(): Promise<void> {
    if (this.#reaping) return
    this.#reaping = true
    try {
      const now = this.#now()
      for (const record of [...this.#pages.values()]) {
        if (now - record.lastAccess >= this.#idleMs) await this.close(record.tab)
      }
      const live = [...this.#pages.values()].sort((left, right) => left.lastAccess - right.lastAccess)
      while (live.length > this.#maxLivePages) {
        const oldest = live.shift()
        if (oldest !== undefined) await this.close(oldest.tab)
      }
    } finally {
      this.#reaping = false
    }
  }

  touch(tab: ManagedTabKey): void {
    const record = this.#pages.get(this.keyOf(tab))
    if (record !== undefined) this.#touch(record)
  }

  async back(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    return this.#navigate(tab, (page) => page.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async forward(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    return this.#navigate(tab, (page) => page.goForward({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async reload(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record !== undefined && isChromiumErrorUrl(record.page.url())) {
      const target = liveHref(record.url)
      if (target !== undefined) return this.ensure(tab, target)
    }
    return this.#navigate(tab, (page) => page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async resize(tab: ManagedTabKey, width: number, height: number): Promise<void> {
    const key = this.keyOf(tab)
    const size = { width: clamp(Math.round(width), 320, 1920), height: clamp(Math.round(height), 240, 1440) }
    this.#requestedViewports.set(key, size)
    const record = this.#pages.get(key)
    if (record === undefined) return
    const current = record.page.viewportSize()
    if (current?.width === size.width && current.height === size.height) return
    await record.page.setViewportSize(size)
  }

  async snapshot(tab: ManagedTabKey): Promise<DriveSnapshot | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    this.#touch(record)
    const nodes = await this.#nodes(record)
    return {
      url: record.url,
      title: record.title,
      driveable: true,
      documentId: record.documentId,
      nodes,
      text: formatTree(nodes, record.title),
    }
  }

  async outline(tab: ManagedTabKey): Promise<ManagedBrowserOutline | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    return { documentId: record.documentId, nodes: await this.#outlineNodes(record) }
  }



  async trackRect(tab: ManagedTabKey, selector: string): Promise<ManagedBrowserTrackedRect | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    const encoded = JSON.stringify(selector)
    const rect = await record.page.evaluate<{ x: number; y: number; w: number; h: number } | null>(String.raw`(() => {
      try {
        const element = document.querySelector(${encoded});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      } catch { return null; }
    })()`)
    return { documentId: record.documentId, selector, rect }
  }

  async click(tab: ManagedTabKey, ref: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.click())
  }

  async fill(tab: ManagedTabKey, ref: string, text: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.fill(text))
  }

  async capture(tab: ManagedTabKey): Promise<ManagedBrowserCapture | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    const nodes = await this.#outlineNodes(record)
    const image = await record.page.screenshot({ type: 'jpeg', quality: EVIDENCE_QUALITY })
    const viewport = record.page.viewportSize() ?? DEFAULT_VIEWPORT
    this.#captureSeq += 1
    return {
      captureId: record.documentId + ':c' + this.#captureSeq,
      documentId: record.documentId,
      url: record.url,
      title: record.title,
      image: new Uint8Array(image),
      mediaType: 'image/jpeg',
      width: viewport.width,
      height: viewport.height,
      nodes,
    }
  }

  target(tab: ManagedTabKey): { page: PageLike; cdp: ManagedCdpSession; documentId: string } | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.page.isClosed()) return undefined
    if (record.status === 'error' || record.status === 'crashed') return undefined
    return { page: record.page, cdp: record.cdp, documentId: record.documentId }
  }

  async close(tab: ManagedTabKey): Promise<void> {
    const key = this.keyOf(tab)
    const record = this.#pages.get(key)
    this.#requestedViewports.delete(key)
    if (record === undefined) return
    this.#pages.delete(key)
    await record.cdp.detach().catch(() => undefined)
    if (!record.page.isClosed()) await record.page.close().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    const pages = [...this.#pages.values()]
    this.#pages.clear()
    this.#requestedViewports.clear()
    await Promise.all(pages.map(async (record) => {
      await record.cdp.detach().catch(() => undefined)
      if (!record.page.isClosed()) await record.page.close().catch(() => undefined)
    }))
    const context = this.#context
    this.#context = undefined
    if (context !== undefined) await (await context).close().catch(() => undefined)
  }

  async #record(tab: ManagedTabKey): Promise<PageRecord> {
    const key = this.keyOf(tab)
    const existing = this.#pages.get(key)
    if (existing !== undefined) return existing
    const context = await this.#ensureContext()
    const page = await context.newPage()
    const requestedViewport = this.#requestedViewports.get(key)
    if (requestedViewport !== undefined) await page.setViewportSize(requestedViewport)
    const cdp = await context.newCDPSession(page)
    const record: PageRecord = {
      tab,
      key,
      page,
      cdp,
      url: page.url(),
      title: '',
      status: 'idle',
      documentSeq: 0,
      documentId: key + ':d0',
      refs: new Map(),
      command: Promise.resolve(),
      lastAccess: this.#now(),
    }
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      if (isChromiumErrorUrl(frame.url())) {
        record.status = 'error'
        record.error ??= '页面加载失败'
        this.#publish(record)
        return
      }
      record.url = frame.url()
      if (record.blocked) {
        this.#publish(record)
        return
      }
      record.documentSeq += 1
      record.status = 'loading'
      delete record.error
      record.documentId = record.key + ':d' + record.documentSeq
      record.refs.clear()
      this.#publish(record)
    })
    page.on('domcontentloaded', () => { void this.#refresh(record).catch((error) => { this.#fail(record, error) }) })
    page.on('crash', () => {
      record.status = 'crashed'
      record.error = 'Chromium page crashed'
      record.refs.clear()
      this.#publish(record)
    })
    page.on('close', () => {
      if (this.#pages.get(key) !== record) return
      this.#pages.delete(key)
    })
    page.on('popup', (popup) => { this.#onPopup?.(tab, popup) })
    this.#pages.set(key, record)
    return record
  }

  async #ensureContext(): Promise<ContextLike> {
    const existing = this.#context
    if (existing !== undefined) return existing
    const pending = (async () => {
      const executablePath = await findBrowserExecutable(this.#executablePath)
      await mkdir(this.profileDir, { recursive: true, mode: 0o700 })
      const releaseLease = await acquireProfileInitializationLease(this.profileDir, this.#profileLeaseTimeoutMs)
      try {
        const singleton = await chromiumSingletonState(this.profileDir)
        if (!singletonAllowsInitialization(singleton)) throw chromiumProfileInUse(singleton)
        await this.#cleanupDerivedCaches(
          this.profileDir,
          this.#cacheBudgetBytes,
          async () => singletonAllowsInitialization(await chromiumSingletonState(this.profileDir)),
        ).catch((error) => {
          this.#onWarning('managed Browser cache cleanup failed: ' + errorMessage(error))
        })
        const beforeLaunch = await chromiumSingletonState(this.profileDir)
        if (!singletonAllowsInitialization(beforeLaunch)) throw chromiumProfileInUse(beforeLaunch)
        return await this.#launch(this.profileDir, {
          executablePath,
          headless: this.headless,
          viewport: DEFAULT_VIEWPORT,
          deviceScaleFactor: DEFAULT_DEVICE_SCALE_FACTOR,
          ignoreDefaultArgs: PLAYWRIGHT_IGNORE_DEFAULT_ARGS,
          args: [
            '--disk-cache-size=' + this.#cacheBudgetBytes,
            '--media-cache-size=' + this.#cacheBudgetBytes,
          ],
        })
      } finally {
        await releaseLease().catch((error) => {
          this.#onWarning('managed Browser profile initialization lease release failed: ' + errorMessage(error))
        })
      }
    })()
    this.#context = pending
    try {
      const context = await pending
      context.on('close', () => {
        if (this.#context !== pending) return
        this.#context = undefined
        const records = [...this.#pages.values()]
        this.#pages.clear()
        for (const record of records) {
          record.status = 'crashed'
          record.error = 'Chromium context exited'
          record.refs.clear()
          this.#publish(record)
        }
      })
      return context
    } catch (error) {
      if (this.#context === pending) this.#context = undefined
      throw error
    }
  }

  async #navigate(tab: ManagedTabKey, command: (page: PageLike) => Promise<unknown>): Promise<ManagedBrowserProjection | undefined> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined) return undefined
    await this.#enqueue(record, async () => {
      record.status = 'loading'
      this.#publish(record)
      try {
        await command(record.page)
        await this.#refresh(record)
      } catch (error) {
        this.#fail(record, error)
      }
    })
    return project(record)
  }

  async #refresh(record: PageRecord): Promise<void> {
    const pageUrl = record.page.url()
    if (isChromiumErrorUrl(pageUrl)) {
      record.status = 'error'
      record.error ??= '页面加载失败'
      this.#publish(record)
      return
    }
    record.url = pageUrl
    record.title = await record.page.title().catch(() => record.url)
    if (record.blocked) {
      record.status = 'error'
      this.#publish(record)
      return
    }
    if (isChallengePage(record.url, record.title)) {
      record.blocked = true
      record.status = 'error'
      record.error = CHALLENGE_BLOCK_MESSAGE
      this.#publish(record)
      await record.page.goto('about:blank').catch(() => undefined)
      record.status = 'error'
      record.error = CHALLENGE_BLOCK_MESSAGE
      this.#publish(record)
      return
    }
    record.status = 'ready'
    delete record.error
    this.#publish(record)
  }

  #touch(record: PageRecord): void {
    record.lastAccess = this.#now()
  }

  #fail(record: PageRecord, error: unknown): void {
    record.status = 'error'
    record.error = error instanceof Error ? error.message : String(error)
    record.refs.clear()
    this.#publish(record)
  }

  #publish(record: PageRecord): void {
    this.#onProjection?.(project(record))
  }

  async #nodes(record: PageRecord): Promise<DriveNode[]> {
    const raw = await record.page.evaluate<Array<{ role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }>>(SNAPSHOT_EXPRESSION)
    record.refs.clear()
    return raw.slice(0, 200).map((node, index) => {
      const ref = '@d' + record.documentSeq + 'e' + (index + 1)
      record.refs.set(ref, { documentId: record.documentId, selector: node.selector })
      return { ref, role: node.role, name: node.name, selector: node.selector, ...node.rect === undefined ? {} : { rect: node.rect } }
    })
  }



  async #outlineNodes(record: PageRecord): Promise<DriveNode[]> {
    const raw = await record.page.evaluate<Array<{ role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }>>(OUTLINE_EXPRESSION)
    return raw.slice(0, 800).map((node, index) => ({
      ref: '@d' + record.documentSeq + 'o' + (index + 1),
      role: node.role,
      name: node.name,
      selector: node.selector,
      ...node.rect === undefined ? {} : { rect: node.rect },
    }))
  }

  async #act(tab: ManagedTabKey, ref: string, action: (locator: LocatorLike) => Promise<void>): Promise<ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    this.#touch(record)
    const target = record.refs.get(ref)
    if (target === undefined) {
      if (/^@d\d+e\d+$/.test(ref)) return { ok: false, code: 'stale-ref', message: '页面已导航，先重新 browser_snapshot' }
      return { ok: false, code: 'unknown-ref', message: '找不到 ' + ref + '，先 browser_snapshot 再操作' }
    }
    if (target.documentId !== record.documentId) return { ok: false, code: 'stale-ref', message: '页面已导航，先重新 browser_snapshot' }
    try {
      await action(record.page.locator(target.selector))
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'navigation-failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  async #enqueue(record: PageRecord, command: () => Promise<void>): Promise<void> {
    const run = record.command.then(command, command)
    record.command = run.catch(() => undefined)
    await run
  }
}

export async function findBrowserExecutable(explicit?: string): Promise<string> {
  const candidates = explicit === undefined ? await browserCandidates() : [explicit]
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next known browser path.
    }
  }
  throw new Error(explicit === undefined
    ? 'No Chrome/Chromium executable found; configure executablePath'
    : 'Configured browser executable is not runnable: ' + explicit)
}

async function browserCandidates(): Promise<string[]> {
  const env = process.env
  const cached = await installedPlaywrightChromiumCandidates(playwrightCacheRoot(env))
  const values = [
    env.DSH_CODEX_BROWSER_EXECUTABLE,
    ...cached,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    env.PROGRAMFILES === undefined ? undefined : join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] === undefined ? undefined : join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  return values.filter((value): value is string => value !== undefined && value.length > 0)
}

export async function installedPlaywrightChromiumCandidates(cacheRoot: string): Promise<string[]> {
  const entries = await readdir(cacheRoot, { withFileTypes: true }).catch(() => [])
  const revisions = entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((left, right) => Number(right.name.slice('chromium-'.length)) - Number(left.name.slice('chromium-'.length)))
  const relativeExecutables = process.platform === 'win32'
    ? [join('chrome-win64', 'chrome.exe'), join('chrome-win', 'chrome.exe')]
    : process.platform === 'darwin'
      ? [join('chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]
      : [join('chrome-linux64', 'chrome'), join('chrome-linux', 'chrome')]
  return revisions.flatMap((entry) => relativeExecutables.map((relative) => join(cacheRoot, entry.name, relative)))
}

function playwrightCacheRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH
  if (configured !== undefined && configured.length > 0 && configured !== '0') return resolve(configured)
  return join(homedir(), '.cache', 'ms-playwright')
}


const PROFILE_INITIALIZATION_LEASE_DIR = '.dcs-profile-initialization'
const PROFILE_INITIALIZATION_LEASE_OWNER = 'owner.json'
const PROFILE_INITIALIZATION_LEASE_TIMEOUT_MS = 10_000
const PROFILE_INITIALIZATION_LEASE_RETRY_MS = 25
const PROFILE_INITIALIZATION_ORPHAN_GRACE_MS = 30_000
const CHROMIUM_DERIVED_CACHE_DIRS = [
  ['Default', 'Cache'],
  ['Default', 'Code Cache'],
  ['Default', 'GPUCache'],
  ['GPUCache'],
  ['ShaderCache'],
  ['GrShaderCache'],
  ['GraphiteDawnCache'],
  ['DawnWebGPUCache'],
  ['DawnGraphiteCache'],
] as const

type ChromiumSingletonState = 'none' | 'live' | 'stale' | 'unknown'

async function chromiumSingletonState(profileDir: string): Promise<ChromiumSingletonState> {
  let owner: string
  try {
    owner = await readlink(join(profileDir, 'SingletonLock'))
  } catch (error) {
    return hasErrorCode(error, 'ENOENT') ? 'none' : 'unknown'
  }
  const prefix = hostname() + '-'
  if (!owner.startsWith(prefix)) return 'unknown'
  const rawPid = owner.slice(prefix.length)
  if (!/^\d+$/.test(rawPid)) return 'unknown'
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid < 1) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'live'
  } catch (error) {
    if (!hasErrorCode(error, 'ESRCH')) return 'unknown'
  }
  return 'stale'
}

/**
 * Detach allowlisted derived caches before deleting them after ownership rechecks.
 * @param profileDir Chromium user-data directory.
 * @param budgetBytes Maximum aggregate bytes allowed for derived caches.
 * @param mayDelete Ownership revalidation performed before detachment and detached removal.
 * @returns A promise that settles after eligible cache directories are inspected and removed.
 */
export async function cleanupDerivedChromiumCaches(
  profileDir: string,
  budgetBytes: number,
  mayDelete: () => Promise<boolean>,
): Promise<void> {
  const directories: Array<{ path: string; identity: FilesystemIdentity }> = []
  let total = 0
  for (const segments of CHROMIUM_DERIVED_CACHE_DIRS) {
    const path = join(profileDir, ...segments)
    const info = await lstat(path).catch((error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) continue
    directories.push({ path, identity: filesystemIdentity(info) })
    total += await directoryBytesWithoutSymlinks(path)
  }
  if (total <= budgetBytes) return
  for (const directory of directories) {
    const info = await lstat(directory.path).catch((error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) continue
    if (!sameFilesystemIdentity(filesystemIdentity(info), directory.identity)) continue
    if (!await mayDelete()) return
    const quarantine = join(dirname(directory.path), '.dcs-cache-quarantine-' + randomUUID())
    try {
      await rename(directory.path, quarantine)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue
      throw error
    }
    const detached = await lstat(quarantine)
    if (detached.isSymbolicLink() || !detached.isDirectory()) continue
    if (!sameFilesystemIdentity(filesystemIdentity(detached), directory.identity)) continue
    if (!await mayDelete()) return
    await rm(quarantine, { recursive: true, force: false })
  }
}

type ProfileLeaseOwner = {
  token: string
  hostname: string
  pid: number
  createdAt: number
}

type FilesystemIdentity = {
  dev: number
  ino: number
}

type ProfileLeaseObservation = {
  identity: FilesystemIdentity
  modifiedAt: number
  owner: ProfileLeaseOwner | undefined
  invalidOwnerRecoverable: boolean
}

async function acquireProfileInitializationLease(profileDir: string, timeoutMs: number): Promise<() => Promise<void>> {
  const leaseDir = join(profileDir, PROFILE_INITIALIZATION_LEASE_DIR)
  const ownerPath = join(leaseDir, PROFILE_INITIALIZATION_LEASE_OWNER)
  const owner: ProfileLeaseOwner = {
    token: randomUUID(),
    hostname: hostname(),
    pid: process.pid,
    createdAt: Date.now(),
  }
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await mkdir(leaseDir, { mode: 0o700 })
      const identity = filesystemIdentity(await lstat(leaseDir))
      try {
        await writeFile(ownerPath, JSON.stringify(owner), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      } catch (error) {
        await reclaimProfileInitializationLease(leaseDir, identity).catch(() => false)
        throw error
      }
      return async () => {
        const current = await readProfileLeaseOwner(ownerPath)
        if (current?.token !== owner.token) return
        if (!await reclaimProfileInitializationLease(leaseDir, identity)) {
          throw new Error('Chromium profile initialization lease identity changed before release')
        }
      }
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
    const observation = await observeProfileInitializationLease(leaseDir)
    if (observation !== undefined && await profileLeaseMayBeReclaimed(observation) &&
      await reclaimProfileInitializationLease(leaseDir, observation.identity)) {
      continue
    }
    if (Date.now() >= deadline) throw new Error('Chromium profile initialization is locked by another Host: ' + profileDir)
    await delay(PROFILE_INITIALIZATION_LEASE_RETRY_MS)
  }
}

async function observeProfileInitializationLease(leaseDir: string): Promise<ProfileLeaseObservation | undefined> {
  const info = await lstat(leaseDir).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  })
  if (info === undefined) return undefined
  if (info.isSymbolicLink() || !info.isDirectory()) return undefined
  const ownerPath = join(leaseDir, PROFILE_INITIALIZATION_LEASE_OWNER)
  const ownerInfo = await lstat(ownerPath).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  })
  const invalidOwnerRecoverable = ownerInfo === undefined || (!ownerInfo.isSymbolicLink() && ownerInfo.isFile())
  return {
    identity: filesystemIdentity(info),
    modifiedAt: Math.max(info.mtimeMs, ownerInfo?.mtimeMs ?? 0),
    owner: invalidOwnerRecoverable ? await readProfileLeaseOwner(ownerPath) : undefined,
    invalidOwnerRecoverable,
  }
}

async function profileLeaseMayBeReclaimed(observation: ProfileLeaseObservation): Promise<boolean> {
  const owner = observation.owner
  if (owner === undefined) {
    return observation.invalidOwnerRecoverable && Date.now() - observation.modifiedAt >= PROFILE_INITIALIZATION_ORPHAN_GRACE_MS
  }
  if (owner.hostname !== hostname()) return false
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    return hasErrorCode(error, 'ESRCH')
  }
}

/**
 * Atomically detach and remove only the lease directory identity previously inspected.
 * @param leaseDir Canonical profile initialization lease directory.
 * @param expected Filesystem identity observed while deciding whether reclaim is safe.
 * @returns Whether the expected lease was detached and removed.
 */
export async function reclaimProfileInitializationLease(
  leaseDir: string,
  expected: FilesystemIdentity,
): Promise<boolean> {
  const current = await lstat(leaseDir).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  })
  if (current === undefined || current.isSymbolicLink() || !current.isDirectory()) return false
  if (!sameFilesystemIdentity(filesystemIdentity(current), expected)) return false
  const quarantine = leaseDir + '.dcs-quarantine-' + randomUUID()
  try {
    await rename(leaseDir, quarantine)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
  const detached = await lstat(quarantine)
  if (!sameFilesystemIdentity(filesystemIdentity(detached), expected)) {
    throw new Error('Chromium profile initialization lease identity changed while it was detached')
  }
  await rm(quarantine, { recursive: true, force: false })
  return true
}

async function readProfileLeaseOwner(ownerPath: string): Promise<ProfileLeaseOwner | undefined> {
  let source: string
  try {
    source = await readFile(ownerPath, 'utf8')
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
    return undefined
  }
  let value: Partial<ProfileLeaseOwner>
  try {
    value = JSON.parse(source) as Partial<ProfileLeaseOwner>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  if (typeof value.token !== 'string' || typeof value.hostname !== 'string') return undefined
  if (!Number.isSafeInteger(value.pid) || typeof value.createdAt !== 'number') return undefined
  return value as ProfileLeaseOwner
}

function chromiumProfileInUse(state: Exclude<ChromiumSingletonState, 'none'>): Error {
  return new Error('Chromium profile is already in use or its owner cannot be verified (' + state + ')')
}

function singletonAllowsInitialization(state: ChromiumSingletonState): state is 'none' | 'stale' {
  return state === 'none' || state === 'stale'
}

function filesystemIdentity(info: { dev: number; ino: number }): FilesystemIdentity {
  return { dev: info.dev, ino: info.ino }
}

function sameFilesystemIdentity(left: FilesystemIdentity, right: FilesystemIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

async function directoryBytesWithoutSymlinks(path: string): Promise<number> {
  let bytes = 0
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      bytes += await directoryBytesWithoutSymlinks(child)
      continue
    }
    if (!entry.isFile()) continue
    bytes += (await lstat(child)).size
  }
  return bytes
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

function defaultProfileDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'codex-sidebar', 'chromium-profile')
}

async function launchPlaywright(profileDir: string, opts: {
  executablePath: string
  headless: boolean
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  ignoreDefaultArgs: string[]
  args: string[]
}): Promise<ContextLike> {
  await mkdir(dirname(profileDir), { recursive: true, mode: 0o700 })
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: opts.executablePath,
    headless: opts.headless,
    viewport: opts.viewport,
    deviceScaleFactor: opts.deviceScaleFactor,
    ignoreDefaultArgs: opts.ignoreDefaultArgs,
    args: opts.args,
  })
  return context as unknown as ContextLike
}

function cacheBudgetBytes(value: number | undefined): number {
  const resolved = value ?? MANAGED_BROWSER_CACHE_BUDGET_BYTES
  if (!Number.isSafeInteger(resolved) || resolved < 0) throw new Error('managedBrowser.cacheBudgetBytes must be a non-negative safe integer')
  return resolved
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function project(record: PageRecord): ManagedBrowserProjection {
  return {
    key: record.key,
    sessionId: record.tab.sessionId,
    tabId: record.tab.tabId,
    url: record.url,
    title: record.title,
    documentId: record.documentId,
    status: record.status,
    ...record.error === undefined ? {} : { error: record.error },
  }
}

function notReady(): ManagedBrowserActionResult {
  return { ok: false, code: 'not-ready', message: '托管浏览器页面尚未加载完成' }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTree(nodes: readonly DriveNode[], title: string): string {
  const lines = ['document "' + title.replace(/"/g, '\"') + '"']
  for (const node of nodes) lines.push('  ' + node.role + ' "' + node.name.replace(/"/g, '\"') + '" [ref=' + node.ref + ']')
  return lines.join('\n')
}



const OUTLINE_EXPRESSION = String.raw`(() => {
  const skipped = new Set(['HTML','BODY','SCRIPT','STYLE','META','LINK','BR','NOSCRIPT','TEMPLATE','SOURCE','PATH','G','DEFS','CLIPPATH']);
  const semantic = new Set(['A','BUTTON','INPUT','TEXTAREA','SELECT','IMG','SVG','VIDEO','CANVAS','H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SUMMARY']);
  const selectorOf = (el) => {
    if (el.id) {
      const selector = '#' + CSS.escape(el.id);
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const test = el.getAttribute('data-testid');
    if (test) {
      const selector = '[data-testid="' + CSS.escape(test) + '"]';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement && parts.length < 8) {
      const parent = current.parentElement;
      const same = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [current];
      parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(current) + 1) + ')');
      const selector = parts.join(' > ');
      if (document.querySelectorAll(selector).length === 1) return selector;
      current = parent;
    }
    return parts.join(' > ');
  };
  const roles = {A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',IMG:'image',SVG:'image',VIDEO:'video',CANVAS:'canvas',H1:'heading',H2:'heading',H3:'heading',H4:'heading',H5:'heading',H6:'heading',P:'paragraph',LI:'listitem',TD:'cell',TH:'columnheader',LABEL:'label',SUMMARY:'button'};
  return Array.from(document.querySelectorAll('*')).flatMap((el) => {
    if (skipped.has(el.tagName)) return [];
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return [];
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
    const rawName = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('value') || '';
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (name.length === 0 && !semantic.has(el.tagName) && !el.hasAttribute('role')) return [];
    const role = el.getAttribute('role') || roles[el.tagName] || el.tagName.toLowerCase();
    return [{ role, name: name || role, selector: selectorOf(el), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }];
  });
})()`

const SNAPSHOT_EXPRESSION = String.raw`(() => {
  const all = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],h1,h2,h3'));
  const selectorOf = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const test = el.getAttribute('data-testid');
    if (test) return '[data-testid="' + CSS.escape(test) + '"]';
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parent = el.parentElement;
    const same = parent ? Array.from(parent.children).filter((child) => child.tagName === el.tagName) : [el];
    return el.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
  };
  return all.flatMap((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return [];
    const role = el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',H1:'heading',H2:'heading',H3:'heading'}[el.tagName] || el.tagName.toLowerCase());
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('value') || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    return [{ role, name, selector: selectorOf(el), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }];
  });
})()`
