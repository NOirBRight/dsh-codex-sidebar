import { describe, expect, it } from 'vitest'
import type { BrowserPort, PageDocument } from '../src/browser.ts'
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

    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const split = box.snapshot()
    expect(split.tabs).toHaveLength(2)
    expect(split.tabs[1]?.kind).toBe('Files')
    expect(split.tabs[1]?.target).toBe('src/Login.tsx')
    expect(split.files.path).toBe('src/Login.tsx')
    expect(split.browser.url).toBe(PAGE_URL)
    expect(split.browser.status).toBe('loaded')
  })

  it('has no 批注 on empty or unreachable chrome, and can 批注 a loaded element', () => {
    const box = session(fakeBrowser())
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    const empty = box.snapshot().browser
    expect(empty.status).toBe('empty')
    expect(empty.canAnnotate).toBe(false)
    box.dispatch({ type: 'browser-set-annotate', on: true })
    expect(box.snapshot().browser.annotate).toBe(false)

    box.dispatch({ type: 'open-url', url: DEAD_URL })
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
    expect(box.dispatch({ type: 'open-url', url: DEAD_URL })).toEqual([])
    expect(box.snapshot().browser.status).toBe('unreachable')
    expect(box.dispatch({ type: 'browser-run' } as Intent)).toEqual([])
    expect(box.dispatch({ type: 'browser-stop' } as Intent)).toEqual([])
    expect(browser.spawned).toEqual([])

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    box.dispatch({ type: 'open-url', url: OTHER_URL })
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
    expect(box.snapshot().browser.attachments).toEqual([
      { id: 'b1', text: 'make this heading red', from: 'h1.signin' },
    ])
    expect(box.snapshot().browser.pendingMark).toBeNull()

    box.dispatch({ type: 'browser-click-content', mark: 'button.submit', x: 2, y: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'and the button' })
    const sent = box.dispatch({ type: 'browser-note-ctrl-enter' })
    expect(sent).toEqual([{
      type: 'send',
      text: 'and the button',
      attachments: [
        { id: 'b1', text: 'make this heading red', from: 'h1.signin' },
        { id: 'b2', text: 'and the button', from: 'button.submit' },
      ],
    }])
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
      text: 'button.submit',
      attachments: [{ id: 'b1', text: 'button.submit', from: 'button.submit' }],
    }])
    busy = false
    box.dispatch({ type: 'browser-click-content', mark: 'h1.signin', x: 2, y: 2 })
    box.dispatch({ type: 'browser-set-note-draft', text: 'make the heading larger' })
    expect(box.dispatch({ type: 'browser-note-ctrl-enter' })[0]?.type).toBe('send')
  })

  it('loads a page snapshot from fetched HTML and treats a failed fetch as unreachable', () => {
    const html = '<html><title>Sign in</title><h1 id="hero">Hello</h1><h2>Sub</h2><button class="go">Go</button><a href="/x">Next</a></html>'
    const opened: string[] = []
    const browser = createHostBrowser({
      isBusy: () => false,
      fetchHtml: (url) => url === PAGE_URL ? html : undefined,
      openExternal: (url) => { opened.push(url) },
    })
    expect(browser.spawn).toBeUndefined()
    const box = session(browser)
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: DEAD_URL })
    expect(box.snapshot().browser.status).toBe('unreachable')
    expect(box.snapshot().browser.canAnnotate).toBe(false)
    expect(box.snapshot().browser.page).toBeNull()

    box.dispatch({ type: 'open-url', url: PAGE_URL })
    const loaded = box.snapshot().browser
    expect(loaded.status).toBe('loaded')
    expect(loaded.page?.title).toBe('Sign in')
    expect(loaded.page?.elements.map((el) => el.selector)).toEqual([
      'h1#hero',
      'h2:nth-of-type(1)',
      'button.go',
      'a:nth-of-type(1)',
    ])
    expect(box.dispatch({ type: 'browser-open-external' })).toEqual([])
    expect(opened).toEqual([PAGE_URL])
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
})
