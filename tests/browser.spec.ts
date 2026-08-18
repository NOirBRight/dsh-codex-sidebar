import { describe, expect, it } from 'vitest'
import { isTakeoverUrl, liveHref, type BrowserPort, type PageDocument } from '../src/browser.ts'
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
const LOOPBACK_URL = 'http://127.0.0.1:43169/'
const NON_HTTP_URL = 'ftp://example.com'

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
  pages: Record<string, PageDocument>
} {
  const pages = opts?.pages ?? { [PAGE_URL]: LOGIN_PAGE, [OTHER_URL]: OTHER_PAGE }
  const spawned: string[] = []
  const opened: string[] = []
  return {
    spawned,
    opened,
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
    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 40, y: 80 })
    expect(box.snapshot().browser.pendingMark).toBe('button.submit')
    expect(box.snapshot().browser.notePos).toEqual({ x: 40, y: 80 })
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 12, y: 20 })
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

  it('stacks 批注 on Enter and sends them to the 主会话 on Ctrl+Enter', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 1, y: 1 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'make this heading red' })
    expect(box.dispatch({ type: 'browser-note-enter' })).toEqual([])
    expect(box.snapshot().attachments).toEqual([
      { id: 'b1', text: 'make this heading red', from: 'h1.signin', source: 'browser' },
    ])
    expect(box.snapshot().browser.pendingMark).toBeNull()
    expect(box.snapshot().browser.attachments).toEqual([])

    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 2, y: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'and the button' })
    const sent = box.dispatch({ type: 'browser-note-ctrl-enter' })
    expect(sent).toEqual([{
      type: 'send',
      text: 'and the button',
      attachments: [
        { id: 'b1', text: 'make this heading red', from: 'h1.signin', source: 'browser' },
        { id: 'b2', text: 'and the button', from: 'button.submit', source: 'browser' },
      ],
    }])
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().browser.attachments).toEqual([])
  })

  it('queues 批注 the same way as Files when the 主会话 is busy', () => {
    let busy = true
    const box = session(fakeBrowser({ busy: () => busy }))
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'browser-set-annotate', on: true })
    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 1, y: 1 })
    const queued = box.dispatch({ type: 'browser-note-ctrl-enter' })
    expect(queued).toEqual([{
      type: 'queue',
      text: '',
      attachments: [{ id: 'b1', text: '', from: 'button.submit', source: 'browser' }],
    }])
    busy = false
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 2, y: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'make the heading larger' })
    expect(box.dispatch({ type: 'browser-note-ctrl-enter' })[0]?.type).toBe('send')
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

  it('lets the iframe try when a localhost or loopback probe is empty or failed', () => {
    const browser = createHostBrowser({
      isBusy: () => false,
      probe: () => ({ kind: 'unreachable' }),
      pickFrameUrl: (url) => {
        if (url.startsWith('http://127.0.0.1:43169')) {
          return 'http://127.0.0.1:9/__dcs/up/127.0.0.1/43169/'
        }
        return undefined
      },
    })
    const box = session(browser)
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.page?.html).toBeUndefined()

    box.dispatch({ type: 'open-url', url: LOOPBACK_URL })
    const loopback = box.snapshot().browser
    expect(loopback.status).toBe('loaded')
    expect(loopback.url).toBe(LOOPBACK_URL)
    expect(loopback.page?.frameUrl).toBe('http://127.0.0.1:9/__dcs/up/127.0.0.1/43169/')
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

  it('keeps an auth-gated origin loadable so the iframe can prompt for credentials', () => {
    const box = session(createHostBrowser({
      isBusy: () => false,
      probe: () => ({ kind: 'auth' }),
    }))
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const loaded = box.snapshot().browser
    expect(loaded.status).toBe('loaded')
    expect(loaded.page?.requiresAuth).toBe(true)
    expect(loaded.page?.html).toBeUndefined()
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

  it('points the iframe at a loopback pick proxy while chrome keeps the typed URL', () => {
    const html = '<html><title>CodexHub</title><ul><li>row</li></ul></html>'
    const browser = createHostBrowser({
      isBusy: () => false,
      probe: () => ({ kind: 'html', html }),
      pickFrameUrl: (url) => url.replace('http://127.0.0.1:1420', 'http://127.0.0.1:9/__dcs/up/127.0.0.1/1420'),
    })
    const box = session(browser)
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: 'http://127.0.0.1:1420' })
    const loaded = box.snapshot().browser
    expect(loaded.url).toBe('http://127.0.0.1:1420')
    expect(loaded.draft).toBe('http://127.0.0.1:1420')
    expect(loaded.status).toBe('loaded')
    expect(loaded.page?.frameUrl).toBe('http://127.0.0.1:9/__dcs/up/127.0.0.1/1420')
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
      pickFrameUrl: (url) => `${url}#proxy`,
    })
    const started = Date.now()
    const box = session(browser)
    box.dispatch({ type: 'open-url', url: PAGE_URL })
    expect(Date.now() - started).toBeLessThan(200)
    expect(box.snapshot().browser.status).toBe('loaded')
    expect(box.snapshot().browser.page?.html).toBeUndefined()
    expect(box.snapshot().browser.page?.frameUrl).toBe(`${PAGE_URL}#proxy`)
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
})
