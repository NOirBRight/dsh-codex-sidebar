/** Deep module: 侧栏 chrome + Files 工具. Tests and the plugin cross this seam. */

import {
  fromBrowserPending,
  fromFileMark,
  fromReviewMark,
  hydrateAnnotation,
  noteBody,
} from './annotation.ts'
import type { BrowserIntent, BrowserPort, BrowserState } from './browser.ts'
import { emptyBrowser, hydrateBrowserPages, normalizeUrl, projectBrowser, reduceBrowser, syncManagedBrowser } from './browser.ts'
import type { FileDiff, ReviewIntent, ReviewPort, ReviewState } from './review.ts'
import { emptyReview, fileDiff, projectReview, reduceReview, rememberReview } from './review.ts'
import type { SideChatIntent, SideChatPort, SideChatState } from './side-chat.ts'
import { emptySideChat, projectSideChat, reduceSideChat } from './side-chat.ts'
import type { TerminalIntent, TerminalPort, TerminalState } from './terminal.ts'
import { emptyTerminal, projectTerminal, reduceTerminal } from './terminal.ts'

export const PALETTE = ['Review', 'Terminal', 'Browser', 'Files'] as const
export const MAX_DELIVERED_MARKS = 100
const MAX_PERSISTED_HUNK_BYTES = 256 * 1024

export function retireSideChatTabs(tabs: readonly Tab[], active: string | null): { tabs: Tab[]; active: string | null } {
  const kept = tabs.filter((tab) => (tab.kind as string | null) !== 'Side Chat')
  return {
    tabs: kept,
    active: kept.some((tab) => tab.id === active) ? active : (kept[0]?.id ?? null),
  }
}
export type ToolKind = (typeof PALETTE)[number]

export type Tab = {
  id: string
  kind: ToolKind | null
  target: string
  title: string
}

export type AnnotationSource = 'files' | 'browser' | 'review'

export type AnnotationRect = { x: number; y: number; w: number; h: number }
export type AnnotationTextRange = { start: number; end: number }

export type BrowserEvidence = {
  id: string
  captureId: string
  documentId: string
  ref: string
  mediaType: 'image/jpeg'
  width: number
  height: number
}

export type Annotation = {
  id: string
  text: string
  from: string
  source: AnnotationSource
  selector?: string
  path?: string
  line?: number
  rect?: AnnotationRect
  selection?: AnnotationTextRange
  url?: string
  evidence?: BrowserEvidence
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
  | { type: 'click-content'; mark: string; x: number; y: number; rect?: AnnotationRect; selection?: AnnotationTextRange }
  | { type: 'dismiss-note' }
  | { type: 'note-add' }
  | { type: 'note-send' }
  | { type: 'composer-send'; text: string }
  | { type: 'restore-attachments'; attachments: Annotation[] }
  | { type: 'set-note-draft'; text: string }
  | { type: 'edit-attachment'; id: string; x?: number; y?: number }
  | { type: 'reveal-mark'; mark: Annotation }
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
    pendingRect: AnnotationRect | null
    pendingSelection: AnnotationTextRange | null
    notePos: NotePos | null
    noteDraft: string
    editingId: string | null
  }
  fileStats: Record<string, { added: number; removed: number }>
  review: ReviewState
  browser: BrowserState
  browsers: Record<string, BrowserState>
  terminal: TerminalState
  sideChat: SideChatState
  attachments: Annotation[]
  deliveredMarks: Annotation[]
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
  /** Set project=false for a pure in-memory snapshot with no Files/Review I/O. */
  snapshot(project?: boolean): SidebarSnapshot
  /** Monotonic state revision used to reject stale async projections. */
  revision(): number
  dispatch(intent: Intent): Effect[]
  pullTerminal(tabId: string, since: number): { seq: number; chunk: string }
}

export function createSidebarSession(opts: SessionOptions): SidebarSession {
  const saved = opts.persist.load(opts.sessionId)
  let seq = saved ? saved.tabs.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0) : 0
  let attachments: Annotation[] = (saved?.attachments ?? []).map(hydrateAnnotation)
  let deliveredMarks: Annotation[] = (saved?.deliveredMarks ?? []).map(hydrateAnnotation).slice(-MAX_DELIVERED_MARKS)
  let queue: Array<{ text: string; attachments: Annotation[] }> = saved?.queue ?? []
  let collapsed = saved?.collapsed ?? true
  const retiredTabs = retireSideChatTabs(saved?.tabs ?? [], saved?.active ?? null)
  let tabs: Tab[] = retiredTabs.tabs
  let active = retiredTabs.active
  let files = saved?.files ?? {
    path: '',
    preview: undefined,
    tree: [],
    treeOpen: false,
    treeWidth: 240,
    view: 'preview',
    hunk: null,
    diff: null,
    annotate: false,
    pendingMark: null,
    pendingRect: null,
    pendingSelection: null,
    notePos: null,
    noteDraft: '',
    editingId: null,
  }
  files = {
    ...files,
    // Derived workspace data is rebuilt only when a visible Files Tab demands it.
    tree: [],
    preview: undefined,
    treeOpen: false,
    treeWidth: clampTreeWidth(files.treeWidth),
    view: files.view === 'diff' ? 'diff' : 'preview',
    hunk: files.hunk ?? null,
    diff: null,
    pendingRect: files.pendingRect ?? null,
    pendingSelection: files.pendingSelection ?? null,
    editingId: files.editingId ?? null,
  }
  let review = saved?.review === undefined ? emptyReview() : rememberReview(saved.review)
  let pages = hydrateBrowserPages(saved)
  let terminal = saved?.terminal ?? emptyTerminal()
  let sideChat = saved?.sideChat ?? emptySideChat()
  let stateRevision = 0

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

  function saveNote(item: Annotation, editingId: string | null): void {
    foldAttachments()
    if (editingId === null) {
      attachments = [...attachments, item]
      return
    }
    attachments = attachments.map((current) => current.id === editingId ? item : current)
  }

  function detachNote(id: string): void {
    foldAttachments()
    attachments = attachments.filter((item) => item.id !== id)
  }

  function takeAttachments(): Annotation[] {
    foldAttachments()
    const payload = attachments
    attachments = []
    deliver(payload)
    return payload
  }

  function deliver(payload: readonly Annotation[]): void {
    if (payload.length === 0) return
    const known = new Set(deliveredMarks.map((item) => item.id))
    deliveredMarks = [...deliveredMarks, ...payload.filter((item) => !known.has(item.id))].slice(-MAX_DELIVERED_MARKS)
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
    const snap = snapshot(false)
    const byTab: typeof snap.terminal.byTab = {}
    for (const [id, rec] of Object.entries(snap.terminal.byTab)) {
      byTab[id] = { ...rec, output: '', chunk: '' }
    }
    opts.persist.save(opts.sessionId, {
      ...snap,
      files: { ...snap.files, tree: [], preview: undefined, hunk: persistedFileChange(snap.files.hunk), diff: null },
      fileStats: {},
      review: rememberReview(snap.review),
      terminal: { byTab },
    })
  }

  function wantFiles(): boolean {
    if (collapsed) return false
    return tabs.find((tab) => tab.id === active)?.kind === 'Files'
  }

  function wantReview(): boolean {
    if (collapsed) return false
    return tabs.find((tab) => tab.id === active)?.kind === 'Review'
  }

  function snapshot(project = true): SidebarSnapshot {
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
      files: project && wantFiles() ? projectFiles() : {
        ...files,
        tree: files.tree ?? [],
        preview: files.preview,
        diff: files.diff ?? null,
      },
      // Workspace stats are supplied by the async inspector; never run git here.
      fileStats: {},
      review: project && wantReview() ? projectReview(review, opts.review) : rememberReview(review),
      browser: projectBrowser(currentBrowser, opts.browser),
      browsers: projectPages(),
      terminal: projectTerminal(terminal),
      sideChat: projectSideChat(sideChat, opts.sideChat),
      attachments: attachments.map((a) => ({ ...a })),
      deliveredMarks: deliveredMarks.map((a) => ({ ...a })),
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
      const action = intent.type === 'browser-back'
        ? 'back'
        : intent.type === 'browser-forward'
          ? 'forward'
          : intent.type === 'browser-refresh'
            ? 'refresh'
            : 'open'
      opts.browser?.manage?.(id, next.state.url, action)
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

  function fillOrOpen(kind: ToolKind, target = '', reveal = true): void {
    if (reveal) expand()
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
    stateRevision += 1
    const effects: Effect[] = []
    switch (intent.type) {
      case 'pick-tool':
        fillOrOpen(intent.kind)
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
      case 'browser-runtime-sync': {
        const current = pages[intent.tabId]
        if (current === undefined) break
        const next = syncManagedBrowser(current, intent)
        putBrowser(intent.tabId, next)
        tabs = tabs.map((tab) => tab.id === intent.tabId
          ? { ...tab, target: next.url, title: intent.title || tabTitle('Browser', next.url) }
          : tab)
        break
      }
      case 'close-tab': {
        opts.browser?.close?.(intent.id)
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
          files = { ...files, path: tab.target, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null }
        }
        if (tab.kind === 'Browser' && pages[tab.id] === undefined && tab.target.length > 0) {
          const loaded = reduceBrowser(emptyBrowser(), { type: 'open-url', url: tab.target } as BrowserIntent, opts.browser)
          if (loaded !== undefined) {
            putBrowser(tab.id, loaded.state)
            opts.browser?.manage?.(tab.id, loaded.state.url, 'open')
          }
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
          pendingRect: null,
          pendingSelection: null,
          notePos: null,
          noteDraft: '',
          editingId: null,
          treeOpen: false,
          view: intent.view === 'diff' ? 'diff' : 'preview',
          hunk: intent.before !== undefined || intent.after !== undefined
            ? { before: intent.before ?? '', after: intent.after ?? '' }
            : null,
        }
        break
      case 'select-file':
        fillOrOpen('Files', intent.path)
        files = { ...files, path: intent.path, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null, hunk: null }
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
          pendingRect: intent.on ? files.pendingRect : null,
          pendingSelection: intent.on ? files.pendingSelection : null,
          notePos: intent.on ? files.notePos : null,
          noteDraft: intent.on ? files.noteDraft : '',
          editingId: intent.on ? files.editingId : null,
        }
        break
      case 'click-content':
        if (files.annotate) {
          files = {
            ...files,
            pendingMark: intent.mark,
            pendingRect: intent.rect ?? null,
            pendingSelection: intent.selection ?? null,
            notePos: { x: intent.x, y: intent.y },
            noteDraft: files.editingId === null ? '' : files.noteDraft,
            editingId: files.editingId,
          }
        }
        break
      case 'dismiss-note':
        files = { ...files, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null }
        break
      case 'set-note-draft':
        files = { ...files, noteDraft: intent.text }
        break
      case 'note-add': {
        if (!files.pendingMark) break
        const item = fromFileMark(files.editingId ?? nid(), files.noteDraft, files.pendingMark, files.pendingRect ?? undefined, files.pendingSelection ?? undefined)
        saveNote(item, files.editingId)
        files = { ...files, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null }
        break
      }
      case 'note-send': {
        if (!files.pendingMark) break
        const item = fromFileMark(files.editingId ?? nid(), files.noteDraft, files.pendingMark, files.pendingRect ?? undefined, files.pendingSelection ?? undefined)
        if (files.editingId !== null) detachNote(files.editingId)
        const text = noteBody(files.noteDraft)
        const payload = [item]
        deliver(payload)
        if (opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        files = { ...files, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null }
        break
      }
      case 'restore-attachments': {
        const known = new Set(attachments.map((item) => item.id))
        const incoming = intent.attachments.filter((item) => !known.has(item.id))
        attachments = [...attachments, ...incoming]
        const restored = new Set(incoming.map((item) => item.id))
        deliveredMarks = deliveredMarks.filter((item) => !restored.has(item.id))
        break
      }
      case 'composer-send': {
        const payload = takeAttachments()
        if (intent.text.trim().length === 0 && payload.length === 0) break
        if (opts.isBusy()) {
          queue = [...queue, { text: intent.text, attachments: payload }]
          effects.push({ type: 'queue', text: intent.text, attachments: payload })
        } else {
          effects.push({ type: 'send', text: intent.text, attachments: payload })
        }
        break
      }
      case 'reveal-mark': {
        const item = hydrateAnnotation(intent.mark)
        expand()
        if (item.source === 'files' && item.path !== undefined) {
          fillOrOpen('Files', item.path)
          files = {
            ...files,
            path: item.path,
            annotate: true,
            pendingMark: item.selector ?? item.from,
            pendingRect: item.rect ?? null,
            pendingSelection: item.selection ?? null,
            notePos: null,
            noteDraft: '',
            editingId: null,
          }
          break
        }
        if (item.source === 'browser') {
          const url = item.url ?? tabs.find((tab) => tab.kind === 'Browser')?.target ?? ''
          fillOrOpen('Browser', url)
          const tabId = browserTabId()
          if (tabId === undefined) break
          let current = pages[tabId] ?? emptyBrowser()
          if (current.url.length === 0 && url.length > 0) {
            current = reduceBrowser(current, { type: 'open-url', url } as BrowserIntent, opts.browser)?.state ?? current
            opts.browser?.manage?.(tabId, current.url, 'open')
          }
          putBrowser(tabId, {
            ...current,
            annotate: true,
            pendingMark: item.from,
            pendingSelector: item.selector ?? null,
            pendingRect: item.rect ?? null,
            pendingCaptureId: item.evidence?.captureId ?? null,
            pendingDocumentId: item.evidence?.documentId ?? null,
            pendingEvidence: item.evidence ?? null,
            notePos: null,
            noteDraft: '',
            editingId: null,
          })
          break
        }
        if (item.source === 'review') {
          fillOrOpen('Review')
          review = {
            ...review,
            openPath: item.path ?? review.openPath,
            pendingMark: item.selector ?? item.from,
            noteDraft: '',
            editingId: null,
          }
        }
        break
      }
      case 'edit-attachment': {
        foldAttachments()
        const item = attachments.find((current) => current.id === intent.id)
        if (item === undefined) break
        expand()
        const notePos = { x: intent.x ?? 180, y: intent.y ?? 72 }
        if (item.source === 'files' && item.path !== undefined) {
          fillOrOpen('Files', item.path)
          files = {
            ...files,
            path: item.path,
            annotate: true,
            pendingMark: item.selector ?? item.from,
            pendingRect: item.rect ?? null,
            pendingSelection: item.selection ?? null,
            notePos,
            noteDraft: item.text,
            editingId: item.id,
          }
          break
        }
        if (item.source === 'browser') {
          const url = item.url ?? tabs.find((tab) => tab.kind === 'Browser')?.target ?? ''
          fillOrOpen('Browser', url)
          const tabId = browserTabId()
          if (tabId === undefined) break
          let current = pages[tabId] ?? emptyBrowser()
          if (current.url.length === 0 && url.length > 0) {
            current = reduceBrowser(current, { type: 'open-url', url } as BrowserIntent, opts.browser)?.state ?? current
            opts.browser?.manage?.(tabId, current.url, 'open')
          }
          putBrowser(tabId, {
            ...current,
            annotate: true,
            pendingMark: item.from,
            pendingSelector: item.selector ?? null,
            pendingRect: item.rect ?? null,
            pendingCaptureId: item.evidence?.captureId ?? null,
            pendingDocumentId: item.evidence?.documentId ?? null,
            pendingEvidence: item.evidence ?? null,
            notePos,
            noteDraft: item.text,
            editingId: item.id,
          })
          break
        }
        if (item.source === 'review') {
          fillOrOpen('Review')
          review = {
            ...review,
            openPath: item.path ?? review.openPath,
            pendingMark: item.selector ?? item.from,
            noteDraft: item.text,
            editingId: item.id,
          }
        }
        break
      }
      case 'remove-attachment': {
        detachNote(intent.id)
        if (files.editingId === intent.id) {
          files = { ...files, pendingMark: null, pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null }
        }
        if (review.editingId === intent.id) {
          review = { ...review, pendingMark: null, noteDraft: '', editingId: null }
        }
        for (const [id, current] of Object.entries(pages)) {
          if (current.editingId !== intent.id) continue
          putBrowser(id, {
            ...current,
            pendingMark: null,
            pendingSelector: null,
            pendingRect: null,
            notePos: null,
            noteDraft: '',
            editingId: null,
          })
        }
        break
      }
      case 'browser-note-add': {
        const id = browserTabId()
        const current = id === undefined ? undefined : pages[id]
        if (id === undefined || current === undefined || current.pendingMark === null) break
        const evidence = (intent as BrowserIntent & { type: 'browser-note-add' }).evidence ?? current.pendingEvidence
        if (evidence === null || evidence === undefined) break
        const nextSeq = current.editingId === null ? current.seq + 1 : current.seq
        const item = fromBrowserPending(current.editingId ?? `b${nextSeq}`, current.noteDraft, {
          pendingMark: current.pendingMark,
          pendingSelector: current.pendingSelector,
          pendingRect: current.pendingRect,
          url: current.url,
          evidence,
        })
        saveNote(item, current.editingId)
        putBrowser(id, {
          ...current,
          seq: nextSeq,
          pendingMark: null,
          notePos: null,
          noteDraft: '',
          pendingSelector: null,
          pendingRect: null,
          pendingCaptureId: null,
          pendingDocumentId: null,
          pendingEvidence: null,
          editingId: null,
        })
        break
      }
      case 'browser-note-send': {
        const id = browserTabId()
        const current = id === undefined ? undefined : pages[id]
        if (id === undefined || current === undefined || current.pendingMark === null) break
        const evidence = (intent as BrowserIntent & { type: 'browser-note-send' }).evidence ?? current.pendingEvidence
        if (evidence === null || evidence === undefined) break
        const nextSeq = current.editingId === null ? current.seq + 1 : current.seq
        const item = fromBrowserPending(current.editingId ?? `b${nextSeq}`, current.noteDraft, {
          pendingMark: current.pendingMark,
          pendingSelector: current.pendingSelector,
          pendingRect: current.pendingRect,
          url: current.url,
          evidence,
        })
        if (current.editingId !== null) detachNote(current.editingId)
        const text = noteBody(current.noteDraft)
        const payload = [item]
        deliver(payload)
        putBrowser(id, {
          ...current,
          seq: nextSeq,
          pendingMark: null,
          notePos: null,
          noteDraft: '',
          pendingSelector: null,
          pendingRect: null,
          pendingCaptureId: null,
          pendingDocumentId: null,
          pendingEvidence: null,
          editingId: null,
        })
        if (opts.browser?.isBusy() ?? opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        break
      }
      case 'review-note-add': {
        if (review.pendingMark === null) break
        const nextSeq = review.editingId === null ? review.seq + 1 : review.seq
        const item = fromReviewMark(review.editingId ?? `r${nextSeq}`, review.noteDraft, review.pendingMark)
        saveNote(item, review.editingId)
        review = { ...review, seq: nextSeq, pendingMark: null, noteDraft: '', editingId: null }
        break
      }
      case 'review-note-send': {
        if (review.pendingMark === null) break
        const nextSeq = review.editingId === null ? review.seq + 1 : review.seq
        const item = fromReviewMark(review.editingId ?? `r${nextSeq}`, review.noteDraft, review.pendingMark)
        if (review.editingId !== null) detachNote(review.editingId)
        const text = noteBody(review.noteDraft)
        const payload = [item]
        deliver(payload)
        review = { ...review, seq: nextSeq, pendingMark: null, noteDraft: '', editingId: null }
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
          const reveal = (intent as { reveal?: boolean }).reveal !== false
          fillOrOpen('Browser', url, reveal)
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

  function pullTerminal(tabId: string, since: number): { seq: number; chunk: string } {
    return opts.terminal?.pull?.(tabId, since) ?? { seq: 0, chunk: '' }
  }

  return { snapshot, revision: () => stateRevision, dispatch, pullTerminal }
}

function nextTerminalTitle(list: Array<{ kind: string | null }>): string {
  const n = list.filter((tab) => tab.kind === 'Terminal').length + 1
  return n === 1 ? 'bash' : `bash ${n}`
}

function persistedFileChange(change: FileChange | null): FileChange | null {
  if (change === null) return null
  if (Buffer.byteLength(change.before) + Buffer.byteLength(change.after) > MAX_PERSISTED_HUNK_BYTES) return null
  return { before: change.before, after: change.after }
}

function clampTreeWidth(width: number | undefined): number {
  const n = typeof width === 'number' && Number.isFinite(width) ? Math.round(width) : 240
  return Math.min(420, Math.max(160, n))
}
