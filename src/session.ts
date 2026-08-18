/** Deep module: 侧栏 chrome + Files 工具. Tests and the plugin cross this seam. */

import {
  fromBrowserPending,
  fromFileMark,
  fromReviewMark,
  hydrateAnnotation,
  noteBody,
} from './annotation.ts'
import type { BrowserIntent, BrowserPort, BrowserState } from './browser.ts'
import { emptyBrowser, hydrateBrowserPages, normalizeUrl, projectBrowser, reduceBrowser } from './browser.ts'
import type { FileDiff, ReviewIntent, ReviewPort, ReviewState } from './review.ts'
import { emptyReview, fileDiff, projectReview, reduceReview } from './review.ts'
import type { SideChatIntent, SideChatPort, SideChatState } from './side-chat.ts'
import { emptySideChat, projectSideChat, reduceSideChat } from './side-chat.ts'
import type { TerminalIntent, TerminalPort, TerminalState } from './terminal.ts'
import { emptyTerminal, projectTerminal, reduceTerminal } from './terminal.ts'

export const PALETTE = ['Review', 'Terminal', 'Browser', 'Files', 'Side Chat'] as const
export type ToolKind = (typeof PALETTE)[number]

export type Tab = {
  id: string
  kind: ToolKind | null
  target: string
  title: string
}

export type AnnotationSource = 'files' | 'browser' | 'review'

export type AnnotationRect = { x: number; y: number; w: number; h: number }

export type Annotation = {
  id: string
  text: string
  from: string
  source: AnnotationSource
  selector?: string
  path?: string
  line?: number
  rect?: AnnotationRect
}

export type NotePos = { x: number; y: number }

export type TreeNode = { path: string; name: string; kind?: 'file' | 'dir' }

export type FileChange = { before: string; after: string }

export type FilesPort = {
  read(path: string): string | undefined
  tree(): TreeNode[]
  change?(path: string): FileChange | undefined
  stats?(): Record<string, { added: number; removed: number }>
}

export type PersistPort = {
  load(sessionId: string): SidebarSnapshot | undefined
  save(sessionId: string, snapshot: SidebarSnapshot): void
}

export type Effect =
  | { type: 'send'; text: string; attachments: Annotation[] }
  | { type: 'queue'; text: string; attachments: Annotation[] }
  | { type: 'deliver'; to: string; text: string; sourceTab: string; sourceSession: string }
  | { type: 'side-ask'; tabId: string; text: string; atSeq: number | null }

export type Intent =
  | { type: 'pick-tool'; kind: ToolKind }
  | { type: 'open-empty-tab' }
  | { type: 'open-terminal' }
  | { type: 'close-tab'; id: string }
  | { type: 'select-tab'; id: string }
  | { type: 'toggle-collapsed' }
  | { type: 'open-path'; path: string; view?: 'preview' | 'diff'; before?: string; after?: string }
  | { type: 'select-file'; path: string }
  | { type: 'toggle-tree' }
  | { type: 'set-files-view'; view: 'preview' | 'diff' }
  | { type: 'set-tree-width'; width: number }
  | { type: 'set-annotate'; on: boolean }
  | { type: 'click-content'; mark: string; x: number; y: number }
  | { type: 'dismiss-note' }
  | { type: 'note-enter' }
  | { type: 'note-ctrl-enter' }
  | { type: 'composer-send'; text: string }
  | { type: 'set-note-draft'; text: string }
  | { type: 'remove-attachment'; id: string }
  | { type: 'reorder-tabs'; from: number; to: number }
  | ReviewIntent
  | BrowserIntent
  | TerminalIntent
  | SideChatIntent

export type SidebarSnapshot = {
  sessionId: string
  collapsed: boolean
  tabs: Tab[]
  active: string | null
  showPalette: boolean
  palette: readonly ToolKind[]
  files: {
    path: string
    preview: string | undefined
    tree: TreeNode[]
    treeOpen: boolean
    treeWidth: number
    view: 'preview' | 'diff'
    hunk: FileChange | null
    diff: FileDiff | null
    annotate: boolean
    pendingMark: string | null
    notePos: NotePos | null
    noteDraft: string
  }
  fileStats: Record<string, { added: number; removed: number }>
  review: ReviewState
  browser: BrowserState
  browsers: Record<string, BrowserState>
  terminal: TerminalState
  sideChat: SideChatState
  attachments: Annotation[]
  queue: Array<{ text: string; attachments: Annotation[] }>
}

export type SessionOptions = {
  sessionId: string
  files: FilesPort
  persist: PersistPort
  isBusy: () => boolean
  review?: ReviewPort
  browser?: BrowserPort
  terminal?: TerminalPort
  sideChat?: SideChatPort
}

export type SidebarSession = {
  snapshot(): SidebarSnapshot
  dispatch(intent: Intent): Effect[]
}

export function createSidebarSession(opts: SessionOptions): SidebarSession {
  const saved = opts.persist.load(opts.sessionId)
  let seq = saved ? saved.tabs.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0) : 0
  let attachments: Annotation[] = (saved?.attachments ?? []).map(hydrateAnnotation)
  let queue: Array<{ text: string; attachments: Annotation[] }> = saved?.queue ?? []
  let collapsed = saved?.collapsed ?? true
  let tabs: Tab[] = saved?.tabs ?? []
  let active = saved?.active ?? null
  let files = saved?.files ?? {
    path: '',
    preview: undefined,
    tree: opts.files.tree(),
    treeOpen: false,
    treeWidth: 240,
    view: 'preview',
    hunk: null,
    diff: null,
    annotate: false,
    pendingMark: null,
    notePos: null,
    noteDraft: '',
  }
  files = {
    ...files,
    tree: opts.files.tree(),
    preview: files.path ? opts.files.read(files.path) : undefined,
    treeOpen: false,
    treeWidth: clampTreeWidth(files.treeWidth),
    view: files.view === 'diff' ? 'diff' : 'preview',
    hunk: files.hunk ?? null,
  }
  let review = saved?.review ?? emptyReview()
  let pages = hydrateBrowserPages(saved)
  let terminal = saved?.terminal ?? emptyTerminal()
  let sideChat = saved?.sideChat ?? emptySideChat()

  function nid(): string {
    seq += 1
    return `t${seq}`
  }

  function foldAttachments(): void {
    const extra: Annotation[] = review.attachments.map(hydrateAnnotation)
    let dirty = review.attachments.length > 0
    if (dirty) review = { ...review, attachments: [] }
    const next = { ...pages }
    for (const [id, state] of Object.entries(next)) {
      if (state.attachments.length === 0) continue
      extra.push(...state.attachments.map(hydrateAnnotation))
      next[id] = { ...state, attachments: [] }
      dirty = true
    }
    if (!dirty) return
    pages = next
    attachments = [...attachments, ...extra]
  }

  function stackNote(item: Annotation): void {
    foldAttachments()
    attachments = [...attachments, item]
  }

  function takeAttachments(): Annotation[] {
    foldAttachments()
    const payload = attachments
    attachments = []
    return payload
  }

  function projectFiles(): SidebarSnapshot['files'] {
    const path = files.path
    const preview = path ? opts.files.read(path) : undefined
    const change = files.hunk ?? (path ? opts.files.change?.(path) : undefined)
    const diff = change === undefined || change.before === change.after ? null : fileDiff(change.before, change.after)
    const view = diff === null ? 'preview' : files.view === 'diff' ? 'diff' : 'preview'
    return {
      ...files,
      tree: opts.files.tree(),
      preview,
      treeOpen: files.treeOpen ?? false,
      treeWidth: clampTreeWidth(files.treeWidth),
      view,
      diff,
    }
  }

  function persist(): void {
    const snap = snapshot()
    const byTab: typeof snap.terminal.byTab = {}
    for (const [id, rec] of Object.entries(snap.terminal.byTab)) {
      byTab[id] = { ...rec, output: '', chunk: '' }
    }
    opts.persist.save(opts.sessionId, { ...snap, terminal: { byTab } })
  }

  function snapshot(): SidebarSnapshot {
    foldAttachments()
    const activeTab = tabs.find((t) => t.id === active)
    const showPalette = !activeTab || activeTab.kind === null
    const currentBrowser = pages[browserTabId() ?? ''] ?? emptyBrowser()
    return {
      sessionId: opts.sessionId,
      collapsed,
      tabs: tabs.map((t) => ({ ...t })),
      active,
      showPalette,
      palette: PALETTE,
      files: projectFiles(),
      fileStats: opts.files.stats?.() ?? {},
      review: projectReview(review, opts.review),
      browser: projectBrowser(currentBrowser, opts.browser),
      browsers: projectPages(),
      terminal: projectTerminal(terminal),
      sideChat: projectSideChat(sideChat, opts.sideChat),
      attachments: attachments.map((a) => ({ ...a })),
      queue: queue.map((q) => ({ text: q.text, attachments: q.attachments.map((a) => ({ ...a })) })),
    }
  }

  function expand(): void {
    collapsed = false
  }

  function tabTitle(kind: ToolKind, target: string): string {
    if (kind === 'Terminal') return nextTerminalTitle(tabs)
    if (target.length === 0) return kind
    if (kind === 'Browser') return target.replace(/^https?:\/\//i, '').slice(0, 48) || target
    return target.split('/').pop() ?? kind
  }

  function sameTarget(kind: ToolKind, left: string, right: string): boolean {
    if (left.length === 0 || right.length === 0) return left === right
    if (kind === 'Browser') return normalizeUrl(left) === normalizeUrl(right)
    return left === right
  }

  function stampBrowserTab(url: string): void {
    const tab = tabs.find((item) => item.id === active && item.kind === 'Browser')
    if (tab === undefined || url.length === 0) return
    tab.target = url
    tab.title = tabTitle('Browser', url)
  }

  function browserTabId(): string | undefined {
    const tab = tabs.find((item) => item.id === active && item.kind === 'Browser')
    return tab?.id
  }

  function projectPages(): Record<string, BrowserState> {
    const out: Record<string, BrowserState> = {}
    for (const [id, state] of Object.entries(pages)) {
      out[id] = projectBrowser(state, opts.browser)
    }
    return out
  }

  function putBrowser(tabId: string, state: BrowserState): void {
    pages = { ...pages, [tabId]: state }
  }

  function applyBrowser(intent: { type: string }): Effect[] | undefined {
    const id = browserTabId()
    if (id === undefined) return undefined
    const next = reduceBrowser(pages[id] ?? emptyBrowser(), intent, opts.browser)
    if (next === undefined) return undefined
    putBrowser(id, next.state)
    if (
      intent.type === 'open-url'
      || intent.type === 'browser-follow'
      || intent.type === 'browser-back'
      || intent.type === 'browser-forward'
      || intent.type === 'browser-refresh'
    ) {
      stampBrowserTab(next.state.url)
    }
    return next.effects
  }

  function restoreBrowserTargets(): void {
    tabs = tabs.map((tab) => {
      if (tab.kind !== 'Browser' || tab.target.length > 0) return tab
      const url = pages[tab.id]?.url ?? ''
      if (url.length === 0) return tab
      return { ...tab, target: url, title: tabTitle('Browser', url) }
    })
  }

  restoreBrowserTargets()

  function fillOrOpen(kind: ToolKind, target = ''): void {
    expand()
    if (target) {
      const reuse = tabs.find((t) => t.kind === kind && sameTarget(kind, t.target, target))
      if (reuse) {
        active = reuse.id
        return
      }
    }
    const current = tabs.find((t) => t.id === active)
    if (current?.kind === kind && (current.target.length === 0 || sameTarget(kind, current.target, target))) {
      if (target.length > 0) {
        tabs = tabs.map((t) => (
          t.id === current.id ? { ...t, target, title: tabTitle(kind, target) } : t
        ))
      }
      return
    }
    const empty = tabs.find((t) => t.id === active && t.kind === null)
    if (empty) {
      tabs = tabs.map((t) => (t.id === empty.id ? { ...t, kind, title: tabTitle(kind, target), target } : t))
      return
    }
    const id = nid()
    const tab: Tab = {
      id,
      kind,
      target,
      title: tabTitle(kind, target),
    }
    tabs = [...tabs, tab]
    active = id
  }

  function dispatch(intent: Intent): Effect[] {
    const effects: Effect[] = []
    switch (intent.type) {
      case 'pick-tool':
        fillOrOpen(intent.kind)
        if (intent.kind === 'Files' && !files.path) {
          const first = opts.files.tree()[0]
          if (first) {
            files = { ...files, path: first.path }
            const tab = tabs.find((t) => t.id === active)
            if (tab) tab.target = first.path
          }
        }
        break
      case 'open-terminal': {
        expand()
        const id = nid()
        const title = nextTerminalTitle(tabs)
        tabs = [...tabs, { id, kind: 'Terminal', target: id, title }]
        active = id
        break
      }
      case 'open-empty-tab':
        expand()
        {
          const id = nid()
          tabs = [...tabs, { id, kind: null, target: '', title: 'New tab' }]
          active = id
        }
        break
      case 'close-tab': {
        const next = tabs.filter((t) => t.id !== intent.id)
        if (pages[intent.id] !== undefined) {
          const copy = { ...pages }
          delete copy[intent.id]
          pages = copy
        }
        if (next.length === 0) {
          tabs = []
          active = null
          collapsed = true
        } else {
          tabs = next
          if (active === intent.id) active = next[next.length - 1]?.id ?? null
        }
        break
      }
      case 'select-tab': {
        const tab = tabs.find((t) => t.id === intent.id)
        if (tab === undefined) break
        active = tab.id
        if (tab.kind === 'Files' && tab.target) {
          files = { ...files, path: tab.target, pendingMark: null, notePos: null }
        }
        if (tab.kind === 'Browser' && pages[tab.id] === undefined && tab.target.length > 0) {
          const loaded = reduceBrowser(emptyBrowser(), { type: 'open-url', url: tab.target } as BrowserIntent, opts.browser)
          if (loaded !== undefined) putBrowser(tab.id, loaded.state)
        }
        break
      }
      case 'toggle-collapsed':
        collapsed = !collapsed
        break
      case 'reorder-tabs': {
        const from = intent.from
        const to = intent.to
        if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) break
        const next = [...tabs]
        const [moved] = next.splice(from, 1)
        if (moved === undefined) break
        next.splice(to, 0, moved)
        tabs = next
        break
      }
      case 'open-path':
        fillOrOpen('Files', intent.path)
        files = {
          ...files,
          path: intent.path,
          pendingMark: null,
          notePos: null,
          treeOpen: false,
          view: intent.view === 'diff' ? 'diff' : 'preview',
          hunk: intent.before !== undefined || intent.after !== undefined
            ? { before: intent.before ?? '', after: intent.after ?? '' }
            : null,
        }
        break
      case 'select-file':
        files = { ...files, path: intent.path, pendingMark: null, notePos: null, hunk: null }
        {
          const tab = tabs.find((t) => t.id === active && t.kind === 'Files')
          if (tab) {
            tab.target = intent.path
            tab.title = intent.path.split('/').pop() ?? intent.path
          }
        }
        break
      case 'toggle-tree':
        files = { ...files, treeOpen: !files.treeOpen }
        break
      case 'set-files-view':
        files = { ...files, view: intent.view }
        break
      case 'set-tree-width':
        files = { ...files, treeWidth: clampTreeWidth(intent.width) }
        break
      case 'set-annotate':
        files = {
          ...files,
          annotate: intent.on,
          pendingMark: intent.on ? files.pendingMark : null,
          notePos: intent.on ? files.notePos : null,
          noteDraft: intent.on ? files.noteDraft : '',
        }
        break
      case 'click-content':
        if (files.annotate) {
          files = { ...files, pendingMark: intent.mark, notePos: { x: intent.x, y: intent.y }, noteDraft: '' }
        }
        break
      case 'dismiss-note':
        files = { ...files, pendingMark: null, notePos: null, noteDraft: '' }
        break
      case 'set-note-draft':
        files = { ...files, noteDraft: intent.text }
        break
      case 'note-enter': {
        if (!files.pendingMark) break
        stackNote(fromFileMark(nid(), files.noteDraft, files.pendingMark))
        files = { ...files, pendingMark: null, notePos: null, noteDraft: '' }
        break
      }
      case 'note-ctrl-enter': {
        if (!files.pendingMark) break
        const item = fromFileMark(nid(), files.noteDraft, files.pendingMark)
        const text = noteBody(files.noteDraft)
        const payload = [...takeAttachments(), item]
        if (opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        files = { ...files, pendingMark: null, notePos: null, noteDraft: '' }
        break
      }
      case 'composer-send': {
        const payload = takeAttachments()
        if (opts.isBusy()) {
          queue = [...queue, { text: intent.text, attachments: payload }]
          effects.push({ type: 'queue', text: intent.text, attachments: payload })
        } else {
          effects.push({ type: 'send', text: intent.text, attachments: payload })
        }
        break
      }
      case 'remove-attachment': {
        foldAttachments()
        attachments = attachments.filter((item) => item.id !== intent.id)
        break
      }
      case 'browser-note-enter': {
        const id = browserTabId()
        const current = id === undefined ? undefined : pages[id]
        if (id === undefined || current === undefined || current.pendingMark === null) break
        const seq = current.seq + 1
        stackNote(fromBrowserPending(`b${seq}`, current.noteDraft, {
          pendingMark: current.pendingMark,
          pendingSelector: current.pendingSelector,
          pendingRect: current.pendingRect,
        }))
        putBrowser(id, { ...current, seq, pendingMark: null, notePos: null, noteDraft: '', pendingSelector: null, pendingRect: null })
        break
      }
      case 'browser-note-ctrl-enter': {
        const id = browserTabId()
        const current = id === undefined ? undefined : pages[id]
        if (id === undefined || current === undefined || current.pendingMark === null) break
        const seq = current.seq + 1
        const item = fromBrowserPending(`b${seq}`, current.noteDraft, {
          pendingMark: current.pendingMark,
          pendingSelector: current.pendingSelector,
          pendingRect: current.pendingRect,
        })
        const text = noteBody(current.noteDraft)
        const payload = [...takeAttachments(), item]
        putBrowser(id, { ...current, seq, pendingMark: null, notePos: null, noteDraft: '', pendingSelector: null, pendingRect: null })
        if (opts.browser?.isBusy() ?? opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        break
      }
      case 'review-note-enter': {
        if (review.pendingMark === null) break
        const seq = review.seq + 1
        stackNote(fromReviewMark(`r${seq}`, review.noteDraft, review.pendingMark))
        review = { ...review, seq, pendingMark: null, noteDraft: '' }
        break
      }
      case 'review-note-ctrl-enter': {
        if (review.pendingMark === null) break
        const seq = review.seq + 1
        const item = fromReviewMark(`r${seq}`, review.noteDraft, review.pendingMark)
        const text = noteBody(review.noteDraft)
        const payload = [...takeAttachments(), item]
        review = { ...review, seq, pendingMark: null, noteDraft: '' }
        if (opts.review?.isBusy() ?? opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        break
      }
      default: {
        if (intent.type === 'open-url') {
          const url = normalizeUrl((intent as { url: string }).url)
          fillOrOpen('Browser', url)
        }
        const nextReview = reduceReview(review, intent, opts.review)
        if (nextReview !== undefined) {
          review = nextReview.state
          effects.push(...nextReview.effects)
          break
        }
        const browserEffects = applyBrowser(intent)
        if (browserEffects !== undefined) {
          effects.push(...browserEffects)
          break
        }
        const nextTerminal = reduceTerminal(terminal, intent, opts.terminal)
        if (nextTerminal !== undefined) {
          terminal = nextTerminal.state
          effects.push(...nextTerminal.effects)
          break
        }
        const nextSideChat = reduceSideChat(sideChat, intent, opts.sideChat)
        if (nextSideChat !== undefined) {
          sideChat = nextSideChat.state
          effects.push(...nextSideChat.effects)
          break
        }
        break
      }
    }
    if (intent.type !== 'terminal-refresh' && intent.type !== 'terminal-write' && intent.type !== 'terminal-resize') persist()
    return effects
  }

  return { snapshot, dispatch }
}

function nextTerminalTitle(list: Array<{ kind: string | null }>): string {
  const n = list.filter((tab) => tab.kind === 'Terminal').length + 1
  return n === 1 ? 'bash' : `bash ${n}`
}

function clampTreeWidth(width: number | undefined): number {
  const n = typeof width === 'number' && Number.isFinite(width) ? Math.round(width) : 240
  return Math.min(420, Math.max(160, n))
}
