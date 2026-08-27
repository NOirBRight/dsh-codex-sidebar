import { describe, expect, it } from 'vitest'
import { browserDeviceViewport, isChromiumErrorUrl, isTakeoverUrl, liveHref, type BrowserDevice, type BrowserPort, type PageDocument } from '../src/browser.ts'
import { createHostBrowser } from '../src/host-browser.ts'
import { createSidebarSession, PALETTE } from '../src/session.ts'
import type { FilesPort, Intent, PersistPort } from '../src/session.ts'

function memoryFiles(files: Record<string, string>): FilesPort {
  return {
    read(path) {
      return files[path]
    },
    tree() {
      return Object.keys(files).sort().map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
      }))
    },
  }
}

function memoryPersist(): PersistPort {
  const map = new Map<string, string>()
  return {
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    save(sessionId, snapshot) {
      map.set(sessionId, JSON.stringify(snapshot))
    },
  }
}

const PAGE_URL = 'http://localhost:5173'
const OTHER_URL = 'http://localhost:3000'
const DEAD_URL = 'http://127.0.0.1:9'
const NON_HTTP_URL = 'ftp://example.com'

function browserEvidence(n: number) {
  return {
    id: 'e' + n,
    captureId: 'sess-a:t1:d1:c' + n,
    documentId: 'sess-a:t1:d1',
    layoutRevision: n,
    mediaGeneration: n,
    ref: '0123456789abcdefabcd/' + String(n).padStart(32, '0') + '.jpg',
    mediaType: 'image/jpeg' as const,
    width: 720,
    height: 860,
  }
}

const LOGIN_PAGE: PageDocument = {
  url: PAGE_URL,
  title: 'Sign in',
  elements: [
    { selector: 'h1.signin', text: 'Sign in' },
    { selector: 'button.submit', text: 'Continue' },
  ],
}

const OTHER_PAGE: PageDocument = {
  url: OTHER_URL,
  title: 'Other',
  elements: [{ selector: 'h1', text: 'Other' }],
}

function fakeBrowser(opts?: { busy?: () => boolean; pages?: Record<string, PageDocument> }): BrowserPort & {
  spawned: string[]
  opened: string[]
  managed: Array<{ tabId: string; url: string; action: 'open' | 'back' | 'forward' | 'refresh' }>
  pages: Record<string, PageDocument>
} {
  const pages = opts?.pages ?? { [PAGE_URL]: LOGIN_PAGE, [OTHER_URL]: OTHER_PAGE }
  const spawned: string[] = []
  const opened: string[] = []
  const managed: Array<{ tabId: string; url: string; action: 'open' | 'back' | 'forward' | 'refresh' }> = []
  return {
    spawned,
    opened,
    managed,
    pages,
    load(url) {
      return pages[url]
    },
    openExternal(url) {
      opened.push(url)
    },
    isBusy() {
      return opts?.busy?.() ?? false
    },
    manage(tabId, url, action) {
      managed.push({ tabId, url, action })
    },
    spawn(command) {
      spawned.push(command)
    },
  }
}

function session(browser: BrowserPort, opts?: { busy?: () => boolean }) {
  return createSidebarSession({
    sessionId: 'sess-a',
    files: memoryFiles({ 'src/Login.tsx': 'export function Login() {\n  return <h1>Sign in</h1>\n}' }),
    persist: memoryPersist(),
    isBusy: opts?.busy ?? (() => false),
    browser,
  })
}

describe('Browser seam', () => {
  it('opens a Browser Tab for a URL, reuses that Tab for the same URL, and leaves paths to Files', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const first = box.snapshot()
    expect(first.collapsed).toBe(false)
    expect(first.showPalette).toBe(false)
    expect(first.palette).toEqual(PALETTE)
    expect(first.tabs).toHaveLength(1)
    expect(first.tabs[0]?.kind).toBe('Browser')
    expect(first.browser.url).toBe(PAGE_URL)
    expect(first.browser.status).toBe('loaded')
    expect(first.browser.page?.title).toBe('Sign in')

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().tabs).toHaveLength(1)
    expect(box.snapshot().browser.history).toEqual([PAGE_URL])

    box.dispatch({ type: 'open-url', url: OTHER_URL })
    expect(box.snapshot().tabs).toHaveLength(2)
    expect(box.snapshot().tabs[0]?.target).toBe(PAGE_URL)
    expect(box.snapshot().tabs[1]?.target).toBe(OTHER_URL)
    expect(box.snapshot().active).toBe(box.snapshot().tabs[1]?.id)
    expect(box.snapshot().browser.url).toBe(OTHER_URL)

    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const split = box.snapshot()
    expect(split.tabs).toHaveLength(3)
    expect(split.tabs[2]?.kind).toBe('Files')
    expect(split.tabs[2]?.target).toBe('src/Login.tsx')
    expect(split.files.path).toBe('src/Login.tsx')
    const otherId = split.tabs[1]?.id as string
    expect(split.browsers[otherId]?.url).toBe(OTHER_URL)
    expect(split.browsers[otherId]?.status).toBe('loaded')
    expect(split.browser.url).toBe('')
  })

  it('opens a new Browser Tab for a different URL and keeps the first Tab target', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'open-url', url: OTHER_URL })
    const snap = box.snapshot()
    expect(snap.tabs).toHaveLength(2)
    expect(snap.tabs.map((tab) => tab.target)).toEqual([PAGE_URL, OTHER_URL])
    expect(snap.tabs[0]?.title).toContain('localhost:5173')
    expect(snap.tabs[1]?.title).toContain('localhost:3000')
  })

  it('keeps two Browser Tabs from overwriting each other', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'open-url', url: OTHER_URL })
    const [firstId, secondId] = box.snapshot().tabs.map((tab) => tab.id)
    expect(box.snapshot().browsers[firstId ?? '']?.url).toBe(PAGE_URL)
    expect(box.snapshot().browsers[firstId ?? '']?.history).toEqual([PAGE_URL])
    expect(box.snapshot().browsers[secondId ?? '']?.url).toBe(OTHER_URL)
    expect(box.snapshot().browsers[secondId ?? '']?.history).toEqual([OTHER_URL])
    box.dispatch({ type: 'select-tab', id: firstId as string })
    expect(box.snapshot().browser.url).toBe(PAGE_URL)
    expect(box.snapshot().browser.history).toEqual([PAGE_URL])
    expect(box.snapshot().browsers[secondId ?? '']?.url).toBe(OTHER_URL)
    expect(box.snapshot().browsers[secondId ?? '']?.history).toEqual([OTHER_URL])
  })

  it('reopens a managed Browser page when its Tab is selected again', () => {
    const browser = fakeBrowser()
    const box = session(browser)
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const tabId = box.snapshot().tabs[0]?.id as string
    const afterOpen = browser.managed.length
    box.dispatch({ type: 'select-tab', id: tabId })
    expect(browser.managed.slice(afterOpen)).toEqual([{ tabId, url: PAGE_URL, action: 'open' }])
  })

  it('reuses a Browser Tab when the same address is written with or without a scheme', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: 'localhost:5173' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().tabs).toHaveLength(1)
    expect(box.snapshot().tabs[0]?.target).toBe(PAGE_URL)
  })

  it('opens Browser from a URL click even when Files is the active Tab', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const snap = box.snapshot()
    expect(snap.tabs).toHaveLength(2)
    expect(snap.tabs[0]?.kind).toBe('Files')
    expect(snap.tabs[1]?.kind).toBe('Browser')
    expect(snap.tabs[1]?.target).toBe(PAGE_URL)
    expect(snap.active).toBe(snap.tabs[1]?.id)
  })

  it('repairs a lone Browser Tab whose target was lost and still opens a new Tab for another URL', () => {
    const persist = memoryPersist()
    const first = createSidebarSession({
      sessionId: 'sess-a',
      files: memoryFiles({ 'src/Login.tsx': 'export function Login() {\n  return <h1>Sign in</h1>\n}' }),
      persist,
      isBusy: () => false,
      browser: fakeBrowser(),
    })
    first.dispatch({ type: 'open-url', url: PAGE_URL })
    const saved = persist.load('sess-a')
    expect(saved).toBeDefined()
    if (saved !== undefined) {
      saved.tabs = saved.tabs.map((tab) => ({ ...tab, target: '' }))
      persist.save('sess-a', saved)
    }
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files: memoryFiles({ 'src/Login.tsx': 'export function Login() {\n  return <h1>Sign in</h1>\n}' }),
      persist,
      isBusy: () => false,
      browser: fakeBrowser(),
    })
    expect(box.snapshot().tabs[0]?.target).toBe(PAGE_URL)
    box.dispatch({ type: 'open-url', url: OTHER_URL })
    expect(box.snapshot().tabs).toHaveLength(2)
    expect(box.snapshot().tabs[1]?.target).toBe(OTHER_URL)
  })

  it('has no 批注 on empty or unreachable chrome, and can 批注 a loaded element', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    const empty = box.snapshot().browser
    expect(empty.status).toBe('empty')
    expect(empty.canAnnotate).toBe(false)
    box.dispatch({ type: 'browser-set-annotate', on: true })
    expect(box.snapshot().browser.annotate).toBe(false)

    box.dispatch({ type: 'open-url', url: NON_HTTP_URL })
    const dead = box.snapshot().browser
    expect(dead.status).toBe('unreachable')
    expect(dead.canAnnotate).toBe(false)
    expect(dead.page).toBeNull()
    box.dispatch({ type: 'browser-set-annotate', on: true })
    expect(box.snapshot().browser.annotate).toBe(false)

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.canAnnotate).toBe(true)
    box.dispatch({ type: 'browser-set-annotate', on: true })
    expect(box.snapshot().browser.annotate).toBe(true)
    expect(box.snapshot().browser.pendingMark).toBeNull()
    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 40, y: 80, captureId: 'c1', documentId: 'd1', layoutRevision: 4, mediaGeneration: 7 })
    expect(box.snapshot().browser.pendingMark).toBe('button.submit')
    expect(box.snapshot().browser.notePos).toEqual({ x: 40, y: 80 })
    expect(box.snapshot().browser).toMatchObject({ pendingLayoutRevision: 4, pendingMediaGeneration: 7 })
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 12, y: 20, captureId: 'c2', documentId: 'd1', layoutRevision: 5, mediaGeneration: 8 })
    expect(box.snapshot().browser.pendingMark).toBe('h1.signin')
    expect(box.snapshot().browser.notePos).toEqual({ x: 12, y: 20 })
    box.dispatch({ type: 'browser-dismiss-note' })
    expect(box.snapshot().browser.pendingMark).toBeNull()
    expect(box.snapshot().browser.notePos).toBeNull()
  })

  it('navigates back, forward, refresh, and open-external without spawning when a URL fails', () => {
    const browser = fakeBrowser()
    const box = session(browser)
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    expect(box.dispatch({ type: 'open-url', url: NON_HTTP_URL })).toEqual([])
    expect(box.snapshot().browser.status).toBe('unreachable')
    expect(box.dispatch({ type: 'browser-run' } as Intent)).toEqual([])
    expect(box.dispatch({ type: 'browser-stop' } as Intent)).toEqual([])
    expect(browser.spawned).toEqual([])

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-follow', url: OTHER_URL })
    expect(box.snapshot().tabs.map((tab) => tab.target)).toEqual([NON_HTTP_URL, OTHER_URL])
    expect(box.snapshot().browser.url).toBe(OTHER_URL)
    expect(box.snapshot().browser.canBack).toBe(true)
    expect(box.snapshot().browser.canForward).toBe(false)

    box.dispatch({ type: 'browser-back' })
    expect(box.snapshot().browser.url).toBe(PAGE_URL)
    expect(box.snapshot().browser.page?.title).toBe('Sign in')
    expect(box.snapshot().browser.canForward).toBe(true)

    box.dispatch({ type: 'browser-forward' })
    expect(box.snapshot().browser.url).toBe(OTHER_URL)

    browser.pages[OTHER_URL] = { ...OTHER_PAGE, title: 'Refreshed' }
    expect(box.snapshot().browser.page?.title).toBe('Other')
    box.dispatch({ type: 'browser-refresh' })
    expect(box.snapshot().browser.page?.title).toBe('Refreshed')

    expect(box.dispatch({ type: 'browser-open-external' })).toEqual([])
    expect(browser.opened).toEqual([OTHER_URL])
  })

  it('adds one Browser 批注 and directly sends only the next one', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 1, y: 1, captureId: browserEvidence(1).captureId, documentId: browserEvidence(1).documentId, layoutRevision: 1, mediaGeneration: 1 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'make this heading red' })
    expect(box.dispatch({ type: 'browser-note-add', evidence: browserEvidence(1) })).toEqual([])
    expect(box.snapshot().attachments).toEqual([
      { id: 'b1', text: 'make this heading red', from: 'h1.signin', source: 'browser', url: PAGE_URL, evidence: browserEvidence(1) },
    ])
    expect(box.snapshot().browser.pendingMark).toBeNull()
    expect(box.snapshot().browser.attachments).toEqual([])

    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 2, y: 2, captureId: browserEvidence(2).captureId, documentId: browserEvidence(2).documentId, layoutRevision: 2, mediaGeneration: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'and the button' })
    const sent = box.dispatch({ type: 'browser-note-send', evidence: browserEvidence(2) })
    expect(sent).toEqual([{
      type: 'send',
      text: 'and the button',
      attachments: [
        { id: 'b2', text: 'and the button', from: 'button.submit', source: 'browser', url: PAGE_URL, evidence: browserEvidence(2) },
      ],
    }])
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]?.id).toBe('b1')
    expect(box.snapshot().browser.attachments).toEqual([])
  })

  it('directly sends only the current Browser 批注 and keeps earlier stacked marks', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({
      type: 'browser-click-content',
      mark: 'h1.signin',
      x: 1,
      y: 1,
      captureId: browserEvidence(1).captureId,
      documentId: browserEvidence(1).documentId,
      layoutRevision: 1,
      mediaGeneration: 1,
      selector: 'h1.signin',
      rect: { x: 10, y: 20, w: 100, h: 30 },
    })
    box.dispatch({ type: 'browser-set-note-draft', text: 'keep stacked' })
    box.dispatch({ type: 'browser-note-add', evidence: browserEvidence(1) })

    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 2, y: 2, captureId: browserEvidence(2).captureId, documentId: browserEvidence(2).documentId, layoutRevision: 2, mediaGeneration: 2, selector: 'button.submit' })
    box.dispatch({ type: 'browser-set-note-draft', text: 'send this' })
    const sent = box.dispatch({ type: 'browser-note-send', evidence: browserEvidence(2) })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'send',
      text: 'send this',
      attachments: [{ text: 'send this', selector: 'button.submit', url: PAGE_URL }],
    })
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]).toMatchObject({ text: 'keep stacked', url: PAGE_URL })
  })

  it('opens a Browser badge for editing, updates it in place, and can delete it', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({
      type: 'browser-click-content',
      mark: 'h1.signin',
      x: 1,
      y: 1,
      captureId: browserEvidence(1).captureId,
      documentId: browserEvidence(1).documentId,
      layoutRevision: 1,
      mediaGeneration: 1,
      selector: 'h1.signin',
      rect: { x: 10, y: 20, w: 100, h: 30 },
    })
    box.dispatch({ type: 'browser-set-note-draft', text: 'old copy' })
    box.dispatch({ type: 'browser-note-add', evidence: browserEvidence(1) })
    const id = box.snapshot().attachments[0]?.id as string

    box.dispatch({ type: 'edit-attachment', id, x: 30, y: 40 })
    expect(box.snapshot().browser).toMatchObject({
      url: PAGE_URL,
      annotate: true,
      pendingMark: 'h1.signin',
      pendingSelector: 'h1.signin',
      pendingRect: { x: 10, y: 20, w: 100, h: 30 },
      notePos: { x: 30, y: 40 },
      noteDraft: 'old copy',
      editingId: id,
    })
    box.dispatch({ type: 'browser-set-note-draft', text: 'new copy' })
    box.dispatch({ type: 'browser-note-add', evidence: browserEvidence(1) })
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]).toMatchObject({ id, text: 'new copy' })

    box.dispatch({ type: 'edit-attachment', id })
    box.dispatch({ type: 'remove-attachment', id })
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().browser.editingId).toBeNull()
  })

  it('queues 批注 the same way as Files when the 主会话 is busy', () => {
    let busy = true
    const box = session(fakeBrowser({ busy: () => busy }))
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 1, y: 1, captureId: browserEvidence(1).captureId, documentId: browserEvidence(1).documentId, layoutRevision: 1, mediaGeneration: 1 })
    const queued = box.dispatch({ type: 'browser-note-send', evidence: browserEvidence(1) })
    expect(queued).toEqual([{
      type: 'queue',
      text: '',
      attachments: [{ id: 'b1', text: '', from: 'button.submit', source: 'browser', url: PAGE_URL, evidence: browserEvidence(1) }],
    }])
    busy = false
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 2, y: 2, captureId: browserEvidence(2).captureId, documentId: browserEvidence(2).documentId, layoutRevision: 2, mediaGeneration: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'make the heading larger' })
    expect(box.dispatch({ type: 'browser-note-send', evidence: browserEvidence(2) })[0]?.type).toBe('send')
  })

  it('loads a page snapshot from fetched HTML and still loads when an http probe fails', () => {
    const html = '<html><title>Sign in</title><h1 id="hero">Hello</h1><h2>Sub</h2><button class="go">Go</button><a href="/x">Next</a></html>'
    const opened: string[] = []
    const browser = createHostBrowser({
      isBusy: () => false,
      probe: (url) => url === PAGE_URL ? { kind: 'html', html } : { kind: 'unreachable' },
      openExternal: (url) => { opened.push(url) },
    })
    expect(browser.spawn).toBeUndefined()
    const box = session(browser)
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: DEAD_URL })
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.page).not.toBeNull()
    expect(box.snapshot().browser.canAnnotate).toBe(true)

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const loaded = box.snapshot().browser
    expect(loaded.status).toBe('loaded')
    expect(loaded.page?.title).toBe('Sign in')
    expect(loaded.page?.html).toContain('<base href="http://localhost:5173">')
    expect(loaded.page?.html).toContain('<h1 id="hero">Hello</h1>')
    expect(loaded.page?.elements.map((el) => el.selector)).toEqual([
      'h1#hero',
      'h2:nth-of-type(1)',
      'button.go',
      'a:nth-of-type(1)',
    ])
    expect(box.dispatch({ type: 'browser-open-external' })).toEqual([])
    expect(opened).toEqual([PAGE_URL])
  })

  it('treats an empty 2xx probe as a loadable page, not a dead host', () => {
    const box = session(createHostBrowser({
      isBusy: () => false,
      probe: () => ({ kind: 'html', html: '' }),
    }))
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.page).not.toBeNull()
  })

  it('keeps a non-http address unreachable', () => {
    const box = session(createHostBrowser({
      isBusy: () => false,
      probe: () => ({ kind: 'unreachable' }),
    }))
    box.dispatch({ type: 'open-url', url: NON_HTTP_URL })
    expect(box.snapshot().browser.status).toBe('unreachable')
    expect(box.snapshot().browser.page).toBeNull()
  })

  it('opens a Browser Tab from an empty 侧栏 and reuses it for the same URL', () => {
    const box = session(fakeBrowser())
    expect(box.snapshot().tabs).toEqual([])
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const first = box.snapshot()
    expect(first.collapsed).toBe(false)
    expect(first.tabs).toHaveLength(1)
    expect(first.tabs[0]?.kind).toBe('Browser')
    expect(first.tabs[0]?.target).toBe(PAGE_URL)
    expect(first.browser.url).toBe(PAGE_URL)
    expect(first.browser.status).toBe('loaded')
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().tabs).toHaveLength(1)
    box.dispatch({ type: 'open-url', url: OTHER_URL })
    expect(box.snapshot().tabs).toHaveLength(2)
    expect(box.snapshot().tabs[1]?.target).toBe(OTHER_URL)
  })

  it('classifies loopback host:port as a page URL and leaves workspace paths alone', () => {
    expect(liveHref('127.0.0.1:43169/')).toBe('http://127.0.0.1:43169/')
    expect(isTakeoverUrl('127.0.0.1:43169/')).toBe(true)
    expect(isTakeoverUrl('localhost:5173')).toBe(true)
    expect(isTakeoverUrl(PAGE_URL)).toBe(true)
    expect(isTakeoverUrl('example.com')).toBe(true)
    expect(isTakeoverUrl('example.com/login')).toBe(true)
    expect(isTakeoverUrl('www.example.com')).toBe(true)
    expect(isTakeoverUrl('src/Login.tsx')).toBe(false)
    expect(isTakeoverUrl('README.md')).toBe(false)
    expect(isTakeoverUrl('Login.tsx')).toBe(false)
    expect(liveHref('src/Login.tsx')).toBeUndefined()
  })

  it('opens an http Tab without waiting on a host HTML probe', () => {
    const browser = createHostBrowser({
      isBusy: () => false,
    })
    const started = Date.now()
    const box = session(browser)
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(Date.now() - started).toBeLessThan(200)
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.page?.html).toBeUndefined()
  })

  it('fills http:// for a host:port URL', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: 'localhost:5173' })
    expect(box.snapshot().browser.url).toBe(PAGE_URL)
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().tabs[0]?.target).toBe(PAGE_URL)
    box.dispatch({ type: 'open-url', url: '127.0.0.1:9' })
    expect(box.snapshot().browser.url).toBe(DEAD_URL)
    expect(box.snapshot().browser.status).toBe('loaded')
  })

  it('persists compact device presets and requests fixed managed viewports', () => {
    const resized: Array<{ tabId: string; mode: BrowserDevice; width: number; height: number }> = []
    const browser = {
      ...fakeBrowser(),
      resize(tabId: string, mode: BrowserDevice, width: number, height: number) { resized.push({ tabId, mode, width, height }) },
    }
    const box = session(browser)
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const tabId = box.snapshot().active as string
    expect(box.snapshot().browser.device).toBe('fit')
    expect(browserDeviceViewport('phone')).toEqual({ width: 390, height: 844 })

    box.dispatch({ type: 'browser-set-device', device: 'phone' })
    expect(box.snapshot().browser.device).toBe('phone')
    expect(resized.at(-1)).toEqual({ tabId, mode: 'phone', width: 390, height: 844 })

    box.dispatch({ type: 'browser-set-device', device: 'laptop' })
    expect(box.snapshot().browser.device).toBe('laptop')
    expect(resized.at(-1)).toEqual({ tabId, mode: 'laptop', width: 1280, height: 800 })

    box.dispatch({ type: 'browser-set-device', device: 'fit' })
    expect(box.snapshot().browser.device).toBe('fit')
    expect(browserDeviceViewport('fit')).toBeNull()
  })

  it('keeps the last http URL when Chromium reports chrome-error://', () => {
    expect(isChromiumErrorUrl('chrome-error://chromewebdata/')).toBe(true)
    expect(liveHref('chrome-error://chromewebdata/')).toBeUndefined()
    const box = session(fakeBrowser())
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const tabId = box.snapshot().active as string
    box.dispatch({
      type: 'browser-runtime-sync',
      tabId,
      url: 'chrome-error://chromewebdata/',
      title: '',
      documentId: 'd2',
      status: 'error',
      error: 'net::ERR_CONNECTION_REFUSED',
    })
    const browser = box.snapshot().browser
    expect(browser.url).toBe(PAGE_URL)
    expect(browser.draft).toBe(PAGE_URL)
    expect(browser.status).toBe('unreachable')
    expect(browser.runtimeError).toContain('REFUSED')
    expect(liveHref(browser.url)).toBe(PAGE_URL)
  })
})
