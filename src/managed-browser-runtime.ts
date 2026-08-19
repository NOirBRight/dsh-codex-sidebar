/** One Host-managed Chromium runtime for every Browser Tab. */

import { constants } from 'node:fs'
import { access, mkdir, readlink, unlink } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import type { DriveNode, DriveSnapshot } from './browser-drive.ts'

export type ManagedTabKey = { sessionId: string; tabId: string }

export type ManagedBrowserConfig = {
  executablePath?: string
  profileDir?: string
  headless?: boolean
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
}) => Promise<ContextLike>

export type ManagedBrowserRuntimeOptions = ManagedBrowserConfig & {
  launch?: LaunchContext
  onProjection?: (projection: ManagedBrowserProjection) => void
  onPopup?: (opener: ManagedTabKey, page: unknown) => void
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
}

const DEFAULT_VIEWPORT = Object.freeze({ width: 720, height: 860 })
const NAVIGATION_TIMEOUT_MS = 30_000
const EVIDENCE_QUALITY = 85

export class ManagedBrowserRuntime {
  readonly profileDir: string
  readonly headless: boolean
  #executablePath: string | undefined
  #launch: LaunchContext
  #context: Promise<ContextLike> | undefined
  #pages = new Map<string, PageRecord>()
  #captureSeq = 0
  #onProjection: ((projection: ManagedBrowserProjection) => void) | undefined
  #onPopup: ((opener: ManagedTabKey, page: unknown) => void) | undefined

  constructor(opts: ManagedBrowserRuntimeOptions = {}) {
    this.profileDir = resolve(opts.profileDir ?? defaultProfileDir())
    this.headless = opts.headless ?? true
    this.#executablePath = opts.executablePath
    this.#launch = opts.launch ?? launchPlaywright
    this.#onProjection = opts.onProjection
    this.#onPopup = opts.onPopup
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
    const record = await this.#record(tab)
    if (record.status === 'ready' && record.page.url() === url) return project(record)
    await this.#enqueue(record, async () => {
      record.status = 'loading'
      record.url = url
      delete record.error
      this.#publish(record)
      try {
        await record.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
        await this.#refresh(record)
      } catch (error) {
        this.#fail(record, error)
      }
    })
    return project(record)
  }

  async back(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    return this.#navigate(tab, (page) => page.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async forward(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    return this.#navigate(tab, (page) => page.goForward({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async reload(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined> {
    return this.#navigate(tab, (page) => page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }))
  }

  async resize(tab: ManagedTabKey, width: number, height: number): Promise<void> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined) return
    const size = { width: clamp(Math.round(width), 320, 1920), height: clamp(Math.round(height), 240, 1440) }
    const current = record.page.viewportSize()
    if (current?.width === size.width && current.height === size.height) return
    await record.page.setViewportSize(size)
  }

  async snapshot(tab: ManagedTabKey): Promise<DriveSnapshot | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
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

  async click(tab: ManagedTabKey, ref: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.click())
  }

  async fill(tab: ManagedTabKey, ref: string, text: string): Promise<ManagedBrowserActionResult> {
    return this.#act(tab, ref, (locator) => locator.fill(text))
  }

  async capture(tab: ManagedTabKey): Promise<ManagedBrowserCapture | ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
    const nodes = await this.#nodes(record)
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
    if (record === undefined || record.status !== 'ready') return undefined
    return { page: record.page, cdp: record.cdp, documentId: record.documentId }
  }

  async close(tab: ManagedTabKey): Promise<void> {
    const key = this.keyOf(tab)
    const record = this.#pages.get(key)
    if (record === undefined) return
    this.#pages.delete(key)
    await record.cdp.detach().catch(() => undefined)
    if (!record.page.isClosed()) await record.page.close().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    const pages = [...this.#pages.values()]
    this.#pages.clear()
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
    }
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      record.documentSeq += 1
      record.status = 'loading'
      delete record.error
      record.documentId = record.key + ':d' + record.documentSeq
      record.refs.clear()
      record.url = frame.url()
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
      await clearStaleChromiumSingleton(this.profileDir)
      return this.#launch(this.profileDir, {
        executablePath,
        headless: this.headless,
        viewport: DEFAULT_VIEWPORT,
      })
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
    record.url = record.page.url()
    record.title = await record.page.title().catch(() => record.url)
    record.status = 'ready'
    delete record.error
    this.#publish(record)
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

  async #act(tab: ManagedTabKey, ref: string, action: (locator: LocatorLike) => Promise<void>): Promise<ManagedBrowserActionResult> {
    const record = this.#pages.get(this.keyOf(tab))
    if (record === undefined || record.status !== 'ready') return notReady()
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
  const candidates = explicit === undefined ? browserCandidates() : [explicit]
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

function browserCandidates(): string[] {
  const env = process.env
  const values = [
    env.DSH_CODEX_BROWSER_EXECUTABLE,
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


const CHROMIUM_SINGLETON_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const

async function clearStaleChromiumSingleton(profileDir: string): Promise<void> {
  let owner: string
  try {
    owner = await readlink(join(profileDir, 'SingletonLock'))
  } catch {
    return
  }
  const prefix = hostname() + '-'
  if (!owner.startsWith(prefix)) return
  const rawPid = owner.slice(prefix.length)
  if (!/^\d+$/.test(rawPid)) return
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid < 1) return
  try {
    process.kill(pid, 0)
    return
  } catch (error) {
    if (!hasErrorCode(error, 'ESRCH')) return
  }
  await Promise.all(CHROMIUM_SINGLETON_FILES.map(async (name) => {
    try {
      await unlink(join(profileDir, name))
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
  }))
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
}): Promise<ContextLike> {
  await mkdir(dirname(profileDir), { recursive: true, mode: 0o700 })
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: opts.executablePath,
    headless: opts.headless,
    viewport: opts.viewport,
  })
  return context as unknown as ContextLike
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
