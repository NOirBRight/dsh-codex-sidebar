/** One Host-managed Chromium runtime for every Browser Tab. */

import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { CHALLENGE_BLOCK_MESSAGE, harnessSelfBlockReason, isChallengePage } from './browser-guard.ts'
import { isChromiumErrorUrl, managedBrowserHref } from './browser.ts'
import type { DriveNode, DriveSnapshot } from './browser-drive.ts'
import { LocalHtmlGateway, type LocalHtmlResources } from './local-html-gateway.ts'
import type { BrowserLayout, BrowserLayoutMode, BrowserSize } from './managed-browser-protocol.ts'
import type { BrowserMediaPage } from './managed-browser-webrtc.ts'

export const MANAGED_BROWSER_MAX_LIVE_PAGES = 3
export const MANAGED_BROWSER_IDLE_MS = 120_000
export const MANAGED_BROWSER_CACHE_BUDGET_BYTES = 256 * 1024 * 1024
export const PLAYWRIGHT_IGNORE_DEFAULT_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]
/** Encoder Chromium must publish host ICE addresses so the GUI peer can connect on loopback. */
export const MANAGED_BROWSER_WEBRTC_CHROMIUM_ARGS = ['--disable-features=WebRtcHideLocalIpsWithMdns'] as const

export type ManagedTabKey = { sessionId: string; tabId: string }

export type ManagedBrowserConfig = {
  executablePath?: string
  profileDir?: string
  headless?: boolean
  /** Maximum total bytes retained in allowlisted Chromium-derived cache directories. */
  cacheBudgetBytes?: number
  /** Minimum adaptive CSS viewport accepted from a Browser client. */
  layoutMinViewport?: BrowserSize
  /** Maximum adaptive CSS viewport accepted from a Browser client. */
  layoutMaxViewport?: BrowserSize
  /** Time a Browser client waits for an adaptive container measurement to settle. */
  layoutSettleMs?: number
  /** Pixel jitter ignored by an adaptive Browser client. */
  layoutHysteresisPx?: number
  /** Raw JPEG ceiling for a same-origin desktop Browser stream frame. */
  desktopJpegMaxRawBytes?: number
  /** Initial desktop JPEG quality from 1 to 100. */
  desktopJpegQuality?: number
  /** Minimum milliseconds between desktop JPEG captures. */
  desktopJpegFrameIntervalMs?: number
  /** Maximum encoded-to-CSS pixel scale for desktop JPEG captures. */
  desktopJpegMaxScale?: number
  /** Chromium screencast change-signal sampling interval for desktop clients. */
  desktopScreencastEveryNthFrame?: number
  /** Maximum passive desktop fallback frames emitted after Browser activity. */
  desktopJpegInteractionBurstFrames?: number
  /** Raw JPEG ceiling before the Mobile tunnel's nested Base64 envelopes. */
  mobileJpegMaxRawBytes?: number
  /** Initial Mobile JPEG quality from 1 to 100. */
  mobileJpegQuality?: number
  /** Minimum milliseconds between Mobile JPEG captures. */
  mobileJpegFrameIntervalMs?: number
  /** Maximum encoded-to-CSS pixel scale for Mobile JPEG captures. */
  mobileJpegMaxScale?: number
  /** Chromium screencast change-signal sampling interval for Mobile clients. */
  mobileScreencastEveryNthFrame?: number
  /** Maximum passive Mobile fallback frames emitted after Browser activity. */
  mobileJpegInteractionBurstFrames?: number
  /** Preferred managed Browser media route. */
  preferredMediaRoute?: 'webrtc-preferred' | 'jpeg-only'
  /** STUN-only ICE server URLs used by managed Browser WebRTC peers. */
  stunUrls?: string[]
  /** Maximum time allowed for one WebRTC negotiation. */
  webrtcNegotiationTimeoutMs?: number
  /** Minimum delay before retrying a failed WebRTC generation. */
  webrtcRetryCooldownMs?: number
  /** Maximum concurrent managed Browser WebRTC peers. */
  maxMediaPeers?: number
  /** Maximum frames per second requested from a direct-video sender. */
  directVideoFrameRate?: number
  /** Maximum direct-video sender bitrate in bits per second. */
  directVideoMaxBitrate?: number
  /** Initial JPEG quality used only to feed the direct-video encoder. */
  directVideoCaptureQuality?: number
  /** Maximum encoded-to-CSS pixel scale used only to feed the direct-video encoder. */
  directVideoCaptureMaxScale?: number
  /** Raw JPEG ceiling used only between the target Page and direct-video encoder. */
  directVideoCaptureMaxRawBytes?: number
  /** Dispose an inactive direct-video peer after this many milliseconds. */
  mediaIdleTimeoutMs?: number
  /** Keep the Browser control connection alive this long after its surface becomes hidden. */
  mediaHideGraceMs?: number
  /** Maximum time allowed for Chromium to confirm a post-viewport-change paint. */
  layoutPaintTimeoutMs?: number
  /** Stop waiting for any Browser-owned cleanup after this deadline. */
  browserCleanupTimeoutMs?: number
  /** Maximum concurrent encoder Pages owned by the managed Browser runtime. */
  maxEncoderPages?: number
}

export type ManagedBrowserLayoutPolicy = {
  minViewport: BrowserSize
  maxViewport: BrowserSize
  settleMs: number
  hysteresisPx: number
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

export type ManagedBrowserCaptureFailure = { ok: false; code: 'stale-layout'; message: string }

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
  /** Exact same-process Page/CDP identity that produced this capture. */
  targetIdentity: ManagedBrowserTargetIdentity
  /** Internal viewport transition epoch that produced this capture. */
  layoutEpoch: number
  captureId: string
  documentId: string
  layoutRevision: number
  mediaGeneration: number
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
  evaluate<R>(expression: string, argument?: unknown): Promise<R>
  exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void>
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

export type ManagedBrowserRuntimeOptions = ManagedBrowserConfig & {
  launch?: LaunchContext
  onProjection?: (projection: ManagedBrowserProjection) => void
  onPopup?: (opener: ManagedTabKey, page: unknown) => void
  now?: () => number
  maxLivePages?: number
  idleMs?: number
  onWarning?: (message: string) => void
  localHtmlGateway?: LocalHtmlGateway
}

type RefTarget = { documentId: string; selector: string }

type PageRecord = {
  identity: ManagedBrowserTargetIdentity
  tab: ManagedTabKey
  key: string
  page: PageLike
  cdp: ManagedCdpSession
  paintBinding: string
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
  layout: BrowserLayout
  layoutEpoch: number
  layoutRunning: boolean
  deviceScaleFactor: number
  pendingLayouts: PendingLayout[]
  visualOperationTail: Promise<void>
}

type LayoutProposal = { mode: BrowserLayoutMode; viewport: BrowserSize }
type CssViewport = BrowserSize & { deviceScaleFactor: number }
type LayoutWaiter = { resolve: (layout: BrowserLayout) => void; reject: (error: unknown) => void }
type PendingLayout =
  | { kind: 'proposal'; proposal: LayoutProposal; waiters: LayoutWaiter[] }
  | { kind: 'verification'; expected: BrowserLayout; waiters: LayoutWaiter[] }
type TabIdentity = { tab: ManagedTabKey }
type PendingPageRecord = { tab: ManagedTabKey; context?: ContextLike; cancelled: boolean; promise: Promise<PageRecord> }

declare const managedBrowserTargetIdentity: unique symbol

/** Opaque object identity for one exact managed Page/CDP record. */
export type ManagedBrowserTargetIdentity = Readonly<{ readonly [managedBrowserTargetIdentity]: true }>

const DEFAULT_VIEWPORT = Object.freeze({ width: 720, height: 860 })
const NAVIGATION_TIMEOUT_MS = 30_000
const EVIDENCE_QUALITY = 85
const DEFAULT_DEVICE_SCALE_FACTOR = 2
const DEFAULT_LAYOUT_PAINT_TIMEOUT_MS = 1_000
const DEFAULT_BROWSER_CLEANUP_TIMEOUT_MS = 2_000
const DEFAULT_LAYOUT_POLICY: ManagedBrowserLayoutPolicy = Object.freeze({
  minViewport: Object.freeze({ width: 320, height: 240 }),
  maxViewport: Object.freeze({ width: 1920, height: 1440 }),
  settleMs: 180,
  hysteresisPx: 8,
})
const FIXED_VIEWPORTS: Record<Exclude<BrowserLayoutMode, 'fit'>, BrowserSize> = Object.freeze({
  phone: Object.freeze({ width: 390, height: 844 }),
  tablet: Object.freeze({ width: 768, height: 1024 }),
  laptop: Object.freeze({ width: 1280, height: 800 }),
})

async function installViewportPaintBinding(cdp: ManagedCdpSession, binding: string): Promise<void> {
  const name = JSON.stringify(binding)
  const source = `(function () { const root = this; const NativePromise = root.Promise; const raf = root.requestAnimationFrame.bind(root); Object.defineProperty(root, ${name}, { configurable: false, enumerable: false, writable: false, value: () => new NativePromise((resolve) => { raf(() => { raf(resolve) }) }) }) })()`
  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })
  assertRuntimeEvaluation(await cdp.send('Runtime.evaluate', { expression: source, returnByValue: true }), 'Cannot install Browser viewport paint function')
}

export class ManagedBrowserRuntime {
  readonly profileDir: string
  readonly headless: boolean
  #executablePath: string | undefined
  #launch: LaunchContext
  #context: Promise<ContextLike> | undefined
  #liveContext: ContextLike | undefined
  #pages = new Map<string, PageRecord>()
  #pendingPages = new Map<string, PendingPageRecord>()
  #ensureCommands = new Map<string, Promise<void>>()
  #tabIdentities = new Map<string, TabIdentity>()
  #requestedViewports = new Map<string, { width: number; height: number }>()
  #leases = new Map<string, Set<object>>()
  #captureSeq = 0
  #onProjection: ((projection: ManagedBrowserProjection) => void) | undefined
  #onPopup: ((opener: ManagedTabKey, page: unknown) => void) | undefined
  #targetInvalidationListeners = new Set<(tab: ManagedTabKey, identity: ManagedBrowserTargetIdentity) => void>()
  #now: () => number
  #maxLivePages: number
  #idleMs: number
  #cacheBudgetBytes: number
  #onWarning: (message: string) => void
  #reaping = false
  #layoutPolicy: ManagedBrowserLayoutPolicy
  #mediaPages = new Set<{ page: PageLike; close: () => Promise<void> }>()
  #mediaPageReservations = 0
  #maxEncoderPages: number
  #layoutPaintTimeoutMs: number
  #cleanupTimeoutMs: number
  #localHtml: LocalHtmlGateway
  #disposed = false
  #disposePromise: Promise<void> | undefined

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
    this.#layoutPolicy = layoutPolicy(opts)
    this.#maxEncoderPages = configuredPositiveInteger(opts.maxEncoderPages, 3, 'maxEncoderPages')
    this.#layoutPaintTimeoutMs = configuredPositiveInteger(opts.layoutPaintTimeoutMs, DEFAULT_LAYOUT_PAINT_TIMEOUT_MS, 'layoutPaintTimeoutMs')
    this.#cleanupTimeoutMs = configuredPositiveInteger(opts.browserCleanupTimeoutMs, DEFAULT_BROWSER_CLEANUP_TIMEOUT_MS, 'browserCleanupTimeoutMs')
    this.#onWarning = opts.onWarning ?? ((message) => { console.warn('[dsh-codex-sidebar] ' + message) })
    this.#localHtml = opts.localHtmlGateway ?? new LocalHtmlGateway()
  }

  keyOf(tab: ManagedTabKey): string {
    return tab.sessionId + ':' + tab.tabId
  }

  /**
   * Observe removal of an exact managed Page/CDP target.
   * @param listener - Synchronous observer invoked before owned target teardown starts.
   * @returns A disposer for this exact observer.
   */
  onTargetInvalidated(listener: (tab: ManagedTabKey, identity: ManagedBrowserTargetIdentity) => void): () => void {
    this.#targetInvalidationListeners.add(listener)
    return () => { this.#targetInvalidationListeners.delete(listener) }
  }

  list(): ManagedBrowserProjection[] {
    return [...this.#pages.values()].map((record) => project(record))
  }

  projection(tab: ManagedTabKey): ManagedBrowserProjection | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    return record === undefined ? undefined : project(record)
  }

  layoutPolicy(): ManagedBrowserLayoutPolicy {
    return {
      minViewport: { ...this.#layoutPolicy.minViewport },
      maxViewport: { ...this.#layoutPolicy.maxViewport },
      settleMs: this.#layoutPolicy.settleMs,
      hysteresisPx: this.#layoutPolicy.hysteresisPx,
    }
  }

  layout(tab: ManagedTabKey): BrowserLayout | undefined {
    const layout = this.#pages.get(this.keyOf(tab))?.layout
    return layout === undefined ? undefined : cloneLayout(layout)
  }

  async ensure(tab: ManagedTabKey, url: string): Promise<ManagedBrowserProjection> {
    const key = this.keyOf(tab)
    const identity = this.#tabIdentities.get(key) ?? { tab }
    this.#tabIdentities.set(key, identity)
    return this.#serializeEnsure(key, identity, async () => this.#ensure(tab, url, key, identity))
  }

  async #ensure(tab: ManagedTabKey, url: string, key: string, identity: TabIdentity): Promise<ManagedBrowserProjection> {
    this.#assertEnsureCurrent(key, identity)
    const publicUrl = managedBrowserHref(url)
    if (publicUrl === undefined) {
      const message = /^file:/i.test(url.trim()) ? 'Only an absolute local HTML file can be opened' : '需要 http、https 或绝对本地 HTML 地址'
      return failedProjection(tab, key, url, message)
    }
    let navigationUrl = publicUrl
    if (publicUrl.startsWith('file:')) {
      try {
        navigationUrl = (await this.#localHtml.open(key, publicUrl)).navigationUrl
        this.#assertEnsureCurrent(key, identity)
      } catch (error) {
        if (this.#tabIdentities.get(key) !== identity) this.#localHtml.release(key)
        return failedProjection(tab, key, publicUrl, errorMessage(error))
      }
    }
    const blocked = harnessSelfBlockReason(publicUrl)
    if (blocked !== undefined) {
      if (this.#pages.has(key)) await this.#closeTab(tab, false)
      return failedProjection(tab, key, publicUrl, blocked)
    }
    let record: PageRecord
    try {
      record = await this.#record(tab)
      this.#assertEnsureCurrent(key, identity)
    } catch (error) {
      if (publicUrl.startsWith('file:')) this.#localHtml.release(key)
      throw error
    }
    if (record.status === 'ready' && record.url === publicUrl) {
      this.#touch(record)
      await this.reap()
      return project(record)
    }
    await this.#enqueue(record, async () => {
      record.status = 'loading'
      record.url = publicUrl
      delete record.error
      delete record.blocked
      this.#publish(record)
      try {
        await record.page.goto(navigationUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
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
    const tabs = new Map<string, ManagedTabKey>()
    for (const record of this.#pages.values()) {
      if (record.tab.sessionId === sessionId) tabs.set(record.key, record.tab)
    }
    for (const identity of this.#tabIdentities.values()) {
      if (identity.tab.sessionId === sessionId) tabs.set(this.keyOf(identity.tab), identity.tab)
    }
    for (const pending of this.#pendingPages.values()) {
      if (pending.tab.sessionId === sessionId) tabs.set(this.keyOf(pending.tab), pending.tab)
    }
    await Promise.all([...tabs.values()].map((tab) => this.close(tab)))
  }

  async reap(): Promise<void> {
    if (this.#reaping) return
    this.#reaping = true
    try {
      const now = this.#now()
      for (const record of [...this.#pages.values()]) {
        if (!this.#leased(record.key) && now - record.lastAccess >= this.#idleMs) await this.#closeTab(record.tab, false)
      }
      const live = [...this.#pages.values()].filter((record) => !this.#leased(record.key)).sort((left, right) => left.lastAccess - right.lastAccess)
      while (this.#pages.size > this.#maxLivePages && live.length > 0) {
        const oldest = live.shift()
        if (oldest !== undefined) await this.#closeTab(oldest.tab, false)
      }
    } finally {
      this.#reaping = false
    }
  }

  touch(tab: ManagedTabKey): void {
    const record = this.#pages.get(this.keyOf(tab))
    if (record !== undefined) this.#touch(record)
  }

  acquire(tab: ManagedTabKey): () => void {
    const key = this.keyOf(tab)
    const lease = {}
    const leases = this.#leases.get(key) ?? new Set<object>()
    leases.add(lease)
    this.#leases.set(key, leases)
    return () => {
      const current = this.#leases.get(key)
      current?.delete(lease)
      if (current?.size === 0) this.#leases.delete(key)
    }
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
      const target = managedBrowserHref(record.url)
      if (target !== undefined) return this.ensure(tab, target)
    }
    return this.#navigate(tab, (page) => page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async resize(tab: ManagedTabKey, width: number, height: number): Promise<void> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined) {
      this.#requestedViewports.set(this.keyOf(tab), normalizeFitViewport({ width, height }, this.#layoutPolicy))
      return
    }
    await this.proposeLayout(tab, { mode: 'fit', viewport: { width, height } })
  }

  /** Commit a proposal only when the optional exact target owns the Tab and reports the requested CSS viewport. */
  async proposeLayout(tab: ManagedTabKey, proposal: LayoutProposal, expectedTarget?: ManagedBrowserTargetIdentity): Promise<BrowserLayout> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined) throw new Error(expectedTarget === undefined ? 'Browser page is not ready' : 'Browser target is no longer current')
    if (expectedTarget !== undefined && record.identity !== expectedTarget) throw new Error('Browser target is no longer current')
    const normalized = normalizeLayoutProposal(proposal, this.#layoutPolicy)
    return await new Promise<BrowserLayout>((resolve, reject) => {
      const waiter = { resolve, reject }
      const pending = record.pendingLayouts.at(-1)
      if (pending?.kind === 'proposal') {
        pending.proposal = normalized
        pending.waiters.push(waiter)
      } else {
        record.pendingLayouts.push({ kind: 'proposal', proposal: normalized, waiters: [waiter] })
      }
      void this.#drainLayouts(record)
    })
  }

  /** Reapply one exact committed layout without creating a new revision. */
  async verifyLayout(tab: ManagedTabKey, expected: BrowserLayout, expectedTarget: ManagedBrowserTargetIdentity): Promise<BrowserLayout> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.identity !== expectedTarget) throw new Error('Browser target is no longer current')
    return await new Promise<BrowserLayout>((resolve, reject) => {
      record.pendingLayouts.push({ kind: 'verification', expected: cloneLayout(expected), waiters: [{ resolve, reject }] })
      void this.#drainLayouts(record)
    })
  }

  async snapshot(tab: ManagedTabKey): Promise<DriveSnapshot | ManagedBrowserActionResult> {
    const record = this.#readableRecord(tab)
    if (record === undefined) return notReady()
    const layoutEpoch = record.layoutEpoch
    const documentId = record.documentId
    this.#touch(record)
    const nodes = await this.#nodes(record, documentId, layoutEpoch)
    if (nodes === undefined || !this.#recordReadable(record, undefined, layoutEpoch, documentId)) return notReady()
    return {
      url: record.url,
      title: record.title,
      driveable: true,
      documentId,
      nodes,
      text: formatTree(nodes, record.title),
    }
  }

  /**
   * Read visible outline nodes only while one optional exact target still owns the Tab.
   * @param tab Managed Browser Tab key.
   * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
   * @returns Outline nodes, or a not-ready result when the target is absent or replaced.
   */
  async outline(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): Promise<ManagedBrowserOutline | ManagedBrowserActionResult> {
    const record = this.#readableRecord(tab, expectedTarget)
    if (record === undefined) return notReady()
    const layoutEpoch = record.layoutEpoch
    const documentId = record.documentId
    const nodes = await this.#outlineNodes(record)
    if (!this.#recordReadable(record, expectedTarget, layoutEpoch, documentId)) return notReady()
    return { documentId, nodes }
  }

  /**
   * Read one selector rectangle only while one optional exact target still owns the Tab.
   * @param tab Managed Browser Tab key.
   * @param selector CSS selector to measure.
   * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
   * @returns Tracked rectangle, or a not-ready result when the target is absent or replaced.
   */
  async trackRect(tab: ManagedTabKey, selector: string, expectedTarget?: ManagedBrowserTargetIdentity): Promise<ManagedBrowserTrackedRect | ManagedBrowserActionResult> {
    const record = this.#readableRecord(tab, expectedTarget)
    if (record === undefined) return notReady()
    const layoutEpoch = record.layoutEpoch
    const documentId = record.documentId
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
    if (!this.#recordReadable(record, expectedTarget, layoutEpoch, documentId)) return notReady()
    return { documentId, selector, rect }
  }

  async click(tab: ManagedTabKey, ref: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.click())
  }

  async fill(tab: ManagedTabKey, ref: string, text: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.fill(text))
  }

  async capture(tab: ManagedTabKey, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<ManagedBrowserCapture | ManagedBrowserActionResult | ManagedBrowserCaptureFailure> {
    const record = this.#readableRecord(tab)
    if (record === undefined) return notReady()
    const layoutEpoch = record.layoutEpoch
    const documentId = record.documentId
    const layout = cloneLayout(record.layout)
    if (!sameLayoutIdentity(layout, expected)) return staleLayout()
    const nodes = await this.#outlineNodes(record)
    if (!this.#captureStillCurrent(record, documentId, layout, layoutEpoch)) return staleLayout()
    const image = await record.page.screenshot({ type: 'jpeg', quality: EVIDENCE_QUALITY })
    if (!this.#captureStillCurrent(record, documentId, layout, layoutEpoch)) return staleLayout()
    const viewport = record.page.viewportSize() ?? DEFAULT_VIEWPORT
    this.#captureSeq += 1
    return {
      targetIdentity: record.identity,
      layoutEpoch,
      captureId: documentId + ':c' + this.#captureSeq,
      documentId,
      layoutRevision: layout.revision,
      mediaGeneration: layout.mediaGeneration,
      url: record.url,
      title: record.title,
      image: new Uint8Array(image),
      mediaType: 'image/jpeg',
      width: viewport.width,
      height: viewport.height,
      nodes,
    }
  }

  /**
   * Return the current public capture identity only while one optional exact target owns the Tab.
   * @param tab Managed Browser Tab key.
   * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
   * @returns Public document and layout identity, or undefined when the target is absent or replaced.
   */
  captureIdentity(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): { documentId: string; layoutRevision: number; mediaGeneration: number; layoutEpoch: number } | undefined {
    const record = this.#readableRecord(tab, expectedTarget)
    if (record === undefined) return undefined
    return { documentId: record.documentId, layoutRevision: record.layout.revision, mediaGeneration: record.layout.mediaGeneration, layoutEpoch: record.layoutEpoch }
  }

  /** Resolve one exact target only when its committed viewport is safe for visual reads. */
  target(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): { identity: ManagedBrowserTargetIdentity; page: PageLike; cdp: ManagedCdpSession; documentId: string; layout: BrowserLayout; layoutEpoch: number; deviceScaleFactor: number } | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.page.isClosed()) return undefined
    if (expectedTarget !== undefined && record.identity !== expectedTarget) return undefined
    if (expectedTarget === undefined && (record.status === 'error' || record.status === 'crashed')) return undefined
    if (record.layoutRunning) return undefined
    return { identity: record.identity, page: record.page, cdp: record.cdp, documentId: record.documentId, layout: cloneLayout(record.layout), layoutEpoch: record.layoutEpoch, deviceScaleFactor: record.deviceScaleFactor }
  }

  /** Resolve an exact target owner for control lifecycle checks without granting visual-read readiness. */
  ownedTarget(tab: ManagedTabKey, expectedTarget: ManagedBrowserTargetIdentity): { identity: ManagedBrowserTargetIdentity; page: PageLike; cdp: ManagedCdpSession; documentId: string; layout: BrowserLayout; layoutEpoch: number; deviceScaleFactor: number } | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.page.isClosed() || record.identity !== expectedTarget) return undefined
    return { identity: record.identity, page: record.page, cdp: record.cdp, documentId: record.documentId, layout: cloneLayout(record.layout), layoutEpoch: record.layoutEpoch, deviceScaleFactor: record.deviceScaleFactor }
  }

  /**
   * Run one browser input atomically with respect to viewport transitions.
   * @param tab Browser Tab owner.
   * @param expectedTarget Exact Page identity accepted for the input.
   * @param expectedLayout Committed revision, document, and internal transition epoch accepted for the input.
   * @param action Complete input gesture to run against the owned CDP session.
   * @returns Whether the gesture ran against the expected target and layout epoch.
   */
  async runInput(
    tab: ManagedTabKey,
    expectedTarget: ManagedBrowserTargetIdentity,
    expectedLayout: Pick<BrowserLayout, 'revision'> & { layoutEpoch: number; documentId: string },
    action: (cdp: ManagedCdpSession, targetIsCurrent: () => boolean) => Promise<void>,
  ): Promise<boolean> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.identity !== expectedTarget || record.page.isClosed()) return false
    const release = await this.#acquireVisualOperation(record)
    try {
      if (!this.#recordReadable(record, expectedTarget, expectedLayout.layoutEpoch, expectedLayout.documentId)
        || record.layout.revision !== expectedLayout.revision) return false
      await action(record.cdp, () => this.#recordCurrent(record, expectedTarget, expectedLayout.layoutEpoch, expectedLayout.documentId))
      return this.#recordCurrent(record, expectedTarget, expectedLayout.layoutEpoch, expectedLayout.documentId)
        && record.layout.revision === expectedLayout.revision
    } finally {
      release()
    }
  }

  /** Lease one narrow media Page from the same persistent Chromium context. */
  async createMediaPage(): Promise<BrowserMediaPage> {
    if (this.#mediaPages.size + this.#mediaPageReservations >= this.#maxEncoderPages) throw new Error('Managed Browser media Page capacity is exhausted')
    this.#mediaPageReservations += 1
    let page: PageLike
    try {
      const context = await this.#ensureContext()
      page = await context.newPage()
    } finally {
      this.#mediaPageReservations -= 1
    }
    let closed = false
    let lease: { page: PageLike; close: () => Promise<void> }
    const adapter: BrowserMediaPage = Object.freeze({
      exposeBinding: async (name, callback) => {
        if (closed) throw new Error('Managed Browser media Page is closed')
        await page.exposeBinding(name, (_source, payload) => { callback({ page: adapter }, payload) })
      },
      evaluateFunction: async <R>(source: string, argument: unknown): Promise<R> => {
        if (closed) throw new Error('Managed Browser media Page is closed')
        const json = JSON.stringify(argument)
        if (json === undefined) throw new Error('Managed Browser media Page accepts JSON arguments only')
        return page.evaluate<R>('(' + source + ')(' + json + ')')
      },
      close: async () => { await lease.close() },
    })
    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      this.#mediaPages.delete(lease)
      if (!page.isClosed()) await page.close()
    }
    lease = { page, close }
    this.#mediaPages.add(lease)
    return adapter
  }

  /** Return the number of owned encoder Pages. */
  mediaPageCount(): number {
    return this.#mediaPages.size
  }

  /** Return path-free local HTML gateway lifecycle counters. */
  localHtmlResources(): LocalHtmlResources {
    return this.#localHtml.resources()
  }

  async close(tab: ManagedTabKey): Promise<void> {
    await this.#closeTab(tab, true)
  }

  async #closeTab(tab: ManagedTabKey, invalidateIdentity: boolean): Promise<void> {
    const key = this.keyOf(tab)
    if (invalidateIdentity || !this.#ensureCommands.has(key)) this.#tabIdentities.delete(key)
    this.#requestedViewports.delete(key)
    this.#leases.delete(key)
    this.#localHtml.release(key)
    const pending = this.#pendingPages.get(key)
    if (pending !== undefined) pending.cancelled = true
    const record = this.#pages.get(key)
    if (record === undefined) return
    this.#invalidateTarget(record)
    this.#pages.delete(key)
    rejectPendingLayout(record, new Error('Browser page closed'))
    await this.#waitForCleanup(this.#cleanupRecord(record))
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#dispose()
    return this.#disposePromise
  }

  async #dispose(): Promise<void> {
    this.#disposed = true
    const pendingPages = [...this.#pendingPages.values()]
    for (const pending of pendingPages) pending.cancelled = true
    this.#pendingPages.clear()
    const pages = [...this.#pages.values()]
    for (const record of pages) this.#invalidateTarget(record)
    this.#pages.clear()
    this.#requestedViewports.clear()
    this.#leases.clear()
    this.#tabIdentities.clear()
    this.#ensureCommands.clear()
    this.#targetInvalidationListeners.clear()
    const mediaPages = [...this.#mediaPages]
    const context = this.#liveContext
    this.#liveContext = undefined
    this.#context = undefined
    const localHtmlClose = this.#localHtml.dispose().catch((error) => {
      this.#onWarning('managed Browser local HTML shutdown failed: ' + errorMessage(error))
    })
    const contextClose = context?.close().catch(() => undefined) ?? Promise.resolve()
    await this.#waitForCleanup(Promise.all([contextClose, localHtmlClose, ...pages.map((record) => {
      rejectPendingLayout(record, new Error('Managed Browser disposed'))
      return this.#cleanupRecord(record)
    }), ...mediaPages.map((lease) => lease.close().catch(() => undefined))]).then(() => undefined))
  }

  async #record(tab: ManagedTabKey): Promise<PageRecord> {
    const key = this.keyOf(tab)
    if (this.#disposed) throw new Error('Managed Browser is disposed')
    const existing = this.#pages.get(key)
    if (existing !== undefined) return existing
    const active = this.#pendingPages.get(key)
    if (active !== undefined) return active.promise
    const pending: PendingPageRecord = { tab, cancelled: false, promise: Promise.resolve(undefined as never) }
    this.#pendingPages.set(key, pending)
    pending.promise = this.#createRecord(tab, pending)
    try {
      return await pending.promise
    } finally {
      if (this.#pendingPages.get(key) === pending) this.#pendingPages.delete(key)
    }
  }

  async #createRecord(tab: ManagedTabKey, pending: PendingPageRecord): Promise<PageRecord> {
    const key = this.keyOf(tab)
    const context = await this.#ensureContext()
    pending.context = context
    this.#assertPendingPageCurrent(pending, context)
    const page = await context.newPage()
    let cdp: ManagedCdpSession | undefined
    try {
      this.#assertPendingPageCurrent(pending, context)
      const requestedViewport = this.#requestedViewports.get(key)
      if (requestedViewport !== undefined) await page.setViewportSize(requestedViewport)
      this.#assertPendingPageCurrent(pending, context)
      cdp = await context.newCDPSession(page)
      this.#assertPendingPageCurrent(pending, context)
      const paintBinding = '__dsh_browser_paint_' + randomBytes(18).toString('base64url')
      await installViewportPaintBinding(cdp, paintBinding)
      this.#assertPendingPageCurrent(pending, context)
      return this.#commitRecord(tab, key, page, cdp, paintBinding, requestedViewport)
    } catch (error) {
      await this.#waitForCleanup(Promise.all([
        cdp?.detach().catch(() => undefined) ?? Promise.resolve(),
        page.isClosed() ? Promise.resolve() : page.close().catch(() => undefined),
      ]).then(() => undefined))
      throw error
    }
  }

  #commitRecord(tab: ManagedTabKey, key: string, page: PageLike, cdp: ManagedCdpSession, paintBinding: string, requestedViewport: BrowserSize | undefined): PageRecord {
    const record: PageRecord = {
      identity: Object.freeze({}) as ManagedBrowserTargetIdentity,
      tab,
      key,
      page,
      cdp,
      paintBinding,
      url: page.url(),
      title: '',
      status: 'idle',
      documentSeq: 0,
      documentId: key + ':d0',
      refs: new Map(),
      command: Promise.resolve(),
      lastAccess: this.#now(),
      layout: {
        revision: 1,
        mode: 'fit',
        viewport: { ...(page.viewportSize() ?? requestedViewport ?? DEFAULT_VIEWPORT) },
        mediaGeneration: 1,
      },
      layoutEpoch: 0,
      layoutRunning: false,
      deviceScaleFactor: DEFAULT_DEVICE_SCALE_FACTOR,
      pendingLayouts: [],
      visualOperationTail: Promise.resolve(),
    }
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      if (isChromiumErrorUrl(frame.url())) {
        record.status = 'error'
        record.error ??= '页面加载失败'
        this.#publish(record)
        return
      }
      record.url = this.#publicPageUrl(record, frame.url())
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
      this.#invalidateTarget(record)
      this.#pages.delete(key)
      this.#localHtml.release(key)
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
      const derivedCacheBytes = await estimateDerivedChromiumCacheBytes(this.profileDir).catch((error) => {
        this.#onWarning('managed Browser cache size estimate failed: ' + errorMessage(error))
        return 0
      })
      const context = await this.#launch(this.profileDir, {
        executablePath,
        headless: this.headless,
        viewport: DEFAULT_VIEWPORT,
        deviceScaleFactor: DEFAULT_DEVICE_SCALE_FACTOR,
        ignoreDefaultArgs: PLAYWRIGHT_IGNORE_DEFAULT_ARGS,
        args: [
          '--disk-cache-size=' + this.#cacheBudgetBytes,
          '--media-cache-size=' + this.#cacheBudgetBytes,
          ...MANAGED_BROWSER_WEBRTC_CHROMIUM_ARGS,
        ],
      })
      let contextClosed = false
      context.on('close', () => {
        contextClosed = true
        if (this.#liveContext === context) this.#liveContext = undefined
        for (const pendingPage of this.#pendingPages.values()) {
          if (pendingPage.context === context) pendingPage.cancelled = true
        }
        if (this.#context !== pending) return
        this.#context = undefined
        this.#mediaPages.clear()
        const records = [...this.#pages.values()]
        for (const record of records) this.#invalidateTarget(record)
        this.#pages.clear()
        for (const record of records) {
          this.#localHtml.release(record.key)
          rejectPendingLayout(record, new Error('Chromium context exited'))
          record.status = 'crashed'
          record.error = 'Chromium context exited'
          record.refs.clear()
          this.#onProjection?.(project(record))
        }
      })
      this.#liveContext = context
      const assertContextAvailable = async (): Promise<void> => {
        if (!contextClosed && !this.#disposed && this.#liveContext === context) return
        const disposed = this.#disposed
        if (this.#liveContext === context) {
          this.#liveContext = undefined
          if (!contextClosed) await context.close().catch(() => undefined)
        }
        throw new Error(disposed ? 'Managed Browser is disposed' : 'Chromium context closed during startup')
      }
      await assertContextAvailable()
      if (derivedCacheBytes > this.#cacheBudgetBytes) {
        try {
          await clearChromiumBrowserCache(context)
        } catch (error) {
          await assertContextAvailable()
          this.#onWarning('managed Browser cache clear failed: ' + errorMessage(error))
        }
        await assertContextAvailable()
      }
      await assertContextAvailable()
      return context
    })()
    this.#context = pending
    try {
      return await pending
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

  #captureStillCurrent(record: PageRecord, documentId: string, layout: BrowserLayout, layoutEpoch: number): boolean {
    return this.#recordReadable(record, undefined, layoutEpoch) && record.documentId === documentId && sameLayoutIdentity(record.layout, layout)
  }

  async #drainLayouts(record: PageRecord): Promise<void> {
    if (record.layoutRunning) return
    record.layoutRunning = true
    const release = await this.#acquireVisualOperation(record)
    try {
      while (record.pendingLayouts.length > 0) {
        const pending = record.pendingLayouts.shift()
        if (pending === undefined) continue
        record.layoutEpoch += 1
        try {
          if (pending.kind === 'verification') {
            if (!sameLayout(record.layout, pending.expected)) throw new Error('Browser layout is no longer current')
            await this.#applyViewport(record, pending.expected.viewport, true)
            this.#assertLayoutRecordCurrent(record)
            if (!sameLayout(record.layout, pending.expected)) throw new Error('Browser layout changed during viewport verification')
            for (const waiter of pending.waiters) waiter.resolve(cloneLayout(record.layout))
            continue
          }
          const current = record.layout
          const next = pending.proposal
          if (current.mode === next.mode && sameSize(current.viewport, next.viewport)) {
            await this.#applyViewport(record, next.viewport, true)
            this.#assertLayoutRecordCurrent(record)
            for (const waiter of pending.waiters) waiter.resolve(cloneLayout(current))
            continue
          }
          await this.#applyViewport(record, next.viewport)
          this.#assertLayoutRecordCurrent(record)
          record.layout = {
            revision: current.revision + 1,
            mode: next.mode,
            viewport: { ...next.viewport },
            mediaGeneration: current.mediaGeneration + 1,
          }
          for (const waiter of pending.waiters) waiter.resolve(cloneLayout(record.layout))
        } catch (error) {
          for (const waiter of pending.waiters) waiter.reject(error)
        }
      }
    } finally {
      release()
      record.layoutRunning = false
      if (record.pendingLayouts.length > 0) void this.#drainLayouts(record)
    }
  }

  async #applyViewport(record: PageRecord, viewport: BrowserSize, verifyFirst = false): Promise<void> {
    try {
      const before = await this.#cssViewport(record)
      const deviceScaleFactor = record.deviceScaleFactor
      if (verifyFirst) {
        if (!cssViewportMatches(before, viewport, deviceScaleFactor)) {
          await record.page.setViewportSize(viewport)
          this.#assertLayoutRecordCurrent(record)
        }
        await this.#applyDeviceMetrics(record, viewport, deviceScaleFactor)
        const forced = await this.#cssViewport(record)
        if (!cssViewportMatches(forced, viewport, deviceScaleFactor)) throw new Error('Chromium did not preserve the Browser viewport')
        await this.#waitForViewportPaint(record)
        return
      }
      await record.page.setViewportSize(viewport)
      this.#assertLayoutRecordCurrent(record)
      const actual = await this.#cssViewport(record)
      if (cssViewportMatches(actual, viewport, deviceScaleFactor)) {
        await this.#waitForViewportPaint(record)
        return
      }
      await this.#applyDeviceMetrics(record, viewport, deviceScaleFactor)
      const overridden = await this.#cssViewport(record)
      if (!cssViewportMatches(overridden, viewport, deviceScaleFactor)) throw new Error('Chromium did not apply the Browser viewport')
      await this.#waitForViewportPaint(record)
    } catch (error) {
      if (this.#pages.get(record.key) === record) await this.#closeTab(record.tab, false)
      throw error
    }
  }

  async #applyDeviceMetrics(record: PageRecord, viewport: BrowserSize, deviceScaleFactor: number): Promise<void> {
    await record.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
      mobile: false,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    })
    this.#assertLayoutRecordCurrent(record)
  }

  async #waitForViewportPaint(record: PageRecord): Promise<void> {
    const capture = () => record.cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 1, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
    })
    const paint = (async () => {
      await record.cdp.send('Page.bringToFront')
      await capture()
      const evaluation = await record.cdp.send('Runtime.evaluate', {
        expression: 'this[' + JSON.stringify(record.paintBinding) + ']()',
        awaitPromise: true,
        returnByValue: true,
      })
      assertRuntimeEvaluation(evaluation, 'Browser viewport paint function failed')
      await capture()
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('Chromium Browser viewport paint timed out')) }, this.#layoutPaintTimeoutMs)
      timer.unref()
    })
    try {
      await Promise.race([paint, deadline])
      this.#assertLayoutRecordCurrent(record)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async #cssViewport(record: PageRecord): Promise<CssViewport> {
    const metrics = await record.cdp.send('Page.getLayoutMetrics') as {
      cssLayoutViewport?: { clientWidth?: unknown; clientHeight?: unknown }
      layoutViewport?: { clientWidth?: unknown; clientHeight?: unknown }
    }
    this.#assertLayoutRecordCurrent(record)
    const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport
    const width = viewport?.clientWidth
    const height = viewport?.clientHeight
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
      throw new Error('Chromium did not report the Browser CSS viewport')
    }
    return { width, height, deviceScaleFactor: record.deviceScaleFactor }
  }

  #assertLayoutRecordCurrent(record: PageRecord): void {
    if (this.#pages.get(record.key) !== record || record.page.isClosed()) throw new Error('Browser page closed during layout commit')
  }

  #readableRecord(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): PageRecord | undefined {
    const record = this.#pages.get(this.keyOf(tab))
    return record !== undefined && this.#recordReadable(record, expectedTarget) ? record : undefined
  }

  #recordReadable(record: PageRecord, expectedTarget?: ManagedBrowserTargetIdentity, expectedLayoutEpoch?: number, expectedDocumentId?: string): boolean {
    return this.#recordCurrent(record, expectedTarget, expectedLayoutEpoch, expectedDocumentId) && !record.layoutRunning
  }

  #recordCurrent(record: PageRecord, expectedTarget?: ManagedBrowserTargetIdentity, expectedLayoutEpoch?: number, expectedDocumentId?: string): boolean {
    return this.#pages.get(record.key) === record && record.status === 'ready' && !record.page.isClosed()
      && (expectedTarget === undefined || record.identity === expectedTarget)
      && (expectedLayoutEpoch === undefined || record.layoutEpoch === expectedLayoutEpoch)
      && (expectedDocumentId === undefined || record.documentId === expectedDocumentId)
  }

  async #acquireVisualOperation(record: PageRecord): Promise<() => void> {
    const previous = record.visualOperationTail
    let release!: () => void
    record.visualOperationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    return release
  }

  async #refresh(record: PageRecord): Promise<void> {
    const pageUrl = record.page.url()
    if (isChromiumErrorUrl(pageUrl)) {
      record.status = 'error'
      record.error ??= '页面加载失败'
      this.#publish(record)
      return
    }
    record.url = this.#publicPageUrl(record, pageUrl)
    record.title = this.#localHtml.redact(record.key, await record.page.title().catch(() => record.url))
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

  #leased(key: string): boolean {
    return (this.#leases.get(key)?.size ?? 0) > 0
  }

  #fail(record: PageRecord, error: unknown): void {
    record.status = 'error'
    record.error = this.#localHtml.redact(record.key, errorMessage(error))
    record.refs.clear()
    this.#publish(record)
  }

  #publish(record: PageRecord): void {
    if (this.#pages.get(record.key) !== record) return
    this.#onProjection?.(project(record))
  }

  #invalidateTarget(record: PageRecord): void {
    for (const listener of this.#targetInvalidationListeners) {
      try {
        listener(record.tab, record.identity)
      } catch (error) {
        this.#onWarning('managed Browser target invalidation observer failed: ' + errorMessage(error))
      }
    }
  }

  #assertPendingPageCurrent(pending: PendingPageRecord, context: ContextLike): void {
    if (pending.cancelled || this.#disposed || this.#liveContext !== context) {
      throw new Error('Browser Page creation was cancelled')
    }
  }

  async #waitForCleanup(cleanup: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolveDeadline) => {
      timer = setTimeout(resolveDeadline, this.#cleanupTimeoutMs)
      timer.unref()
    })
    await Promise.race([cleanup, deadline])
    if (timer !== undefined) clearTimeout(timer)
  }

  async #cleanupRecord(record: PageRecord): Promise<void> {
    await Promise.all([
      record.cdp.detach().catch(() => undefined),
      record.page.isClosed() ? Promise.resolve() : record.page.close().catch(() => undefined),
    ])
  }

  #publicPageUrl(record: PageRecord, navigationUrl: string): string {
    return this.#localHtml.project(record.key, navigationUrl)
      ?? (this.#localHtml.isPrivate(navigationUrl) ? record.url : navigationUrl)
  }

  async #nodes(record: PageRecord, documentId: string, layoutEpoch: number): Promise<DriveNode[] | undefined> {
    const raw = await record.page.evaluate<Array<{ role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }>>(SNAPSHOT_EXPRESSION)
    if (!this.#recordReadable(record, undefined, layoutEpoch, documentId)) return undefined
    record.refs.clear()
    return raw.slice(0, 200).map((node, index) => {
      const ref = '@d' + record.documentSeq + 'e' + (index + 1)
      record.refs.set(ref, { documentId: record.documentId, selector: node.selector })
      return { ref, role: node.role, name: this.#localHtml.redact(record.key, node.name), selector: node.selector, ...node.rect === undefined ? {} : { rect: node.rect } }
    })
  }



  async #outlineNodes(record: PageRecord): Promise<DriveNode[]> {
    const raw = await record.page.evaluate<Array<{ role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number } }>>(OUTLINE_EXPRESSION)
    return raw.slice(0, 800).map((node, index) => ({
      ref: '@d' + record.documentSeq + 'o' + (index + 1),
      role: node.role,
      name: this.#localHtml.redact(record.key, node.name),
      selector: node.selector,
      ...node.rect === undefined ? {} : { rect: node.rect },
    }))
  }

  async #act(tab: ManagedTabKey, ref: string, action: (locator: LocatorLike) => Promise<void>): Promise<ManagedBrowserActionResult> {
    const record = this.#readableRecord(tab)
    if (record === undefined) return notReady()
    const layoutEpoch = record.layoutEpoch
    const documentId = record.documentId
    this.#touch(record)
    const target = record.refs.get(ref)
    if (target === undefined) {
      if (/^@d\d+e\d+$/.test(ref)) return { ok: false, code: 'stale-ref', message: '页面已导航，先重新 browser_snapshot' }
      return { ok: false, code: 'unknown-ref', message: '找不到 ' + ref + '，先 browser_snapshot 再操作' }
    }
    if (target.documentId !== record.documentId) return { ok: false, code: 'stale-ref', message: '页面已导航，先重新 browser_snapshot' }
    const release = await this.#acquireVisualOperation(record)
    try {
      if (!this.#recordReadable(record, undefined, layoutEpoch, documentId)) return notReady()
      await action(record.page.locator(target.selector))
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'navigation-failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      release()
    }
  }

  async #enqueue(record: PageRecord, command: () => Promise<void>): Promise<void> {
    const run = record.command.then(command, command)
    record.command = run.catch(() => undefined)
    await run
  }

  #serializeEnsure<T>(key: string, identity: TabIdentity, command: () => Promise<T>): Promise<T> {
    const previous = this.#ensureCommands.get(key) ?? Promise.resolve()
    const result = previous.then(command, command)
    const settled = result.then(() => undefined, () => undefined)
    this.#ensureCommands.set(key, settled)
    void settled.then(() => {
      if (this.#ensureCommands.get(key) !== settled) return
      this.#ensureCommands.delete(key)
      if (!this.#pages.has(key) && !this.#pendingPages.has(key) && this.#tabIdentities.get(key) === identity) {
        this.#tabIdentities.delete(key)
      }
    })
    return result
  }

  #assertEnsureCurrent(key: string, identity: TabIdentity): void {
    if (this.#disposed) throw new Error('Managed Browser is disposed')
    if (this.#tabIdentities.get(key) !== identity) throw new Error('Browser Tab was closed while opening')
  }
}

function layoutPolicy(config: ManagedBrowserConfig): ManagedBrowserLayoutPolicy {
  const minViewport = configuredSize(config.layoutMinViewport, DEFAULT_LAYOUT_POLICY.minViewport, 'layoutMinViewport')
  const maxViewport = configuredSize(config.layoutMaxViewport, DEFAULT_LAYOUT_POLICY.maxViewport, 'layoutMaxViewport')
  if (minViewport.width > maxViewport.width || minViewport.height > maxViewport.height) {
    throw new Error('managedBrowser layoutMinViewport must not exceed layoutMaxViewport')
  }
  return {
    minViewport,
    maxViewport,
    settleMs: configuredNonNegative(config.layoutSettleMs, DEFAULT_LAYOUT_POLICY.settleMs, 'layoutSettleMs'),
    hysteresisPx: configuredNonNegative(config.layoutHysteresisPx, DEFAULT_LAYOUT_POLICY.hysteresisPx, 'layoutHysteresisPx'),
  }
}

function configuredSize(value: BrowserSize | undefined, fallback: BrowserSize, name: string): BrowserSize {
  if (value === undefined) return { ...fallback }
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0 || value.width > 65_535 || value.height > 65_535) {
    throw new Error('managedBrowser ' + name + ' must contain positive finite 16-bit dimensions')
  }
  return { width: Math.round(value.width), height: Math.round(value.height) }
}

function configuredNonNegative(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) throw new Error('managedBrowser ' + name + ' must be a non-negative finite number')
  return Math.round(value)
}

function configuredPositiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('managedBrowser ' + name + ' must be a positive safe integer')
  return value
}

function normalizeLayoutProposal(proposal: LayoutProposal, policy: ManagedBrowserLayoutPolicy): LayoutProposal {
  const fixed = proposal.mode === 'fit' ? undefined : FIXED_VIEWPORTS[proposal.mode]
  return {
    mode: proposal.mode,
    viewport: fixed === undefined ? normalizeFitViewport(proposal.viewport, policy) : { ...fixed },
  }
}

function normalizeFitViewport(viewport: BrowserSize, policy: ManagedBrowserLayoutPolicy): BrowserSize {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) throw new Error('Browser layout viewport must contain finite dimensions')
  return {
    width: clamp(Math.round(viewport.width), policy.minViewport.width, policy.maxViewport.width),
    height: clamp(Math.round(viewport.height), policy.minViewport.height, policy.maxViewport.height),
  }
}

function sameSize(left: BrowserSize, right: BrowserSize): boolean {
  return left.width === right.width && left.height === right.height
}

function cssViewportMatches(actual: CssViewport, expected: BrowserSize, deviceScaleFactor: number): boolean {
  return sameSize(actual, expected) && actual.deviceScaleFactor === deviceScaleFactor
}

function sameLayoutIdentity(left: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>, right: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): boolean {
  return left.revision === right.revision && left.mediaGeneration === right.mediaGeneration
}

function sameLayout(left: BrowserLayout, right: BrowserLayout): boolean {
  return sameLayoutIdentity(left, right) && left.mode === right.mode && sameSize(left.viewport, right.viewport)
}

function cloneLayout(layout: BrowserLayout): BrowserLayout {
  return { ...layout, viewport: { ...layout.viewport } }
}

function rejectPendingLayout(record: PageRecord, error: Error): void {
  const pending = record.pendingLayouts.splice(0)
  for (const operation of pending) for (const waiter of operation.waiters) waiter.reject(error)
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
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    ...cached,
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

async function estimateDerivedChromiumCacheBytes(profileDir: string): Promise<number> {
  let total = 0
  for (const segments of CHROMIUM_DERIVED_CACHE_DIRS) {
    const path = join(profileDir, ...segments)
    const info = await lstat(path).catch((error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) continue
    total += await directoryBytesWithoutSymlinks(path)
  }
  return total
}

async function clearChromiumBrowserCache(context: ContextLike): Promise<void> {
  const page = await context.newPage()
  let cdp: ManagedCdpSession | undefined
  const failures: unknown[] = []
  try {
    cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.clearBrowserCache')
  } catch (error) {
    failures.push(error)
  } finally {
    if (cdp !== undefined) {
      await cdp.detach().catch((error) => { failures.push(error) })
    }
    await page.close().catch((error) => { failures.push(error) })
  }
  if (failures.length > 0) throw failures[0]
}

async function directoryBytesWithoutSymlinks(path: string): Promise<number> {
  let bytes = 0
  const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return []
    throw error
  })
  for (const entry of entries) {
    const child = join(path, entry.name)
    const info = await lstat(child).catch((error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      throw error
    })
    if (info === undefined || info.isSymbolicLink()) continue
    if (info.isDirectory()) {
      bytes += await directoryBytesWithoutSymlinks(child)
      continue
    }
    if (info.isFile()) bytes += info.size
  }
  return bytes
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

function assertRuntimeEvaluation(value: unknown, message: string): void {
  if (typeof value === 'object' && value !== null && 'exceptionDetails' in value) throw new Error(message)
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

function failedProjection(tab: ManagedTabKey, key: string, url: string, error: string): ManagedBrowserProjection {
  return {
    key,
    sessionId: tab.sessionId,
    tabId: tab.tabId,
    url,
    title: '',
    documentId: key + ':blocked',
    status: 'error',
    error,
  }
}

function notReady(): ManagedBrowserActionResult {
  return { ok: false, code: 'not-ready', message: '托管浏览器页面尚未加载完成' }
}

function staleLayout(): ManagedBrowserCaptureFailure {
  return { ok: false, code: 'stale-layout', message: 'Browser document or layout changed; capture again' }
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
