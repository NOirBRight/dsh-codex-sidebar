/** Deep module: 侧栏 chrome + Files 工具. Tests and the plugin cross this seam. */

import type { BrowserIntent, BrowserState } from './browser.ts'
import { emptyBrowser, reduceBrowser } from './browser.ts'
import type { ReviewIntent, ReviewState } from './review.ts'
import { emptyReview, reduceReview } from './review.ts'
import type { SideChatIntent, SideChatState } from './side-chat.ts'
import { emptySideChat, reduceSideChat } from './side-chat.ts'
import type { TerminalIntent, TerminalState } from './terminal.ts'
import { emptyTerminal, reduceTerminal } from './terminal.ts'

export const PALETTE = ['Review', 'Terminal', 'Browser', 'Files', 'Side Chat'] as const
export type ToolKind = (typeof PALETTE)[number]

export type Tab = {
  id: string
  kind: ToolKind | null
  target: string
  title: string
}

export type Annotation = {
  id: string
  text: string
  from: string
}

export type NotePos = { x: number; y: number }

export type TreeNode = { path: string; name: string }

export type FilesPort = {
  read(path: string): string | undefined
  tree(): TreeNode[]
}

export type PersistPort = {
  load(sessionId: string): SidebarSnapshot | undefined
  save(sessionId: string, snapshot: SidebarSnapshot): void
}

export type Effect =
  | { type: 'send'; text: string; attachments: Annotation[] }
  | { type: 'queue'; text: string; attachments: Annotation[] }

export type Intent =
  | { type: 'pick-tool'; kind: ToolKind }
  | { type: 'open-empty-tab' }
  | { type: 'close-tab'; id: string }
  | { type: 'select-tab'; id: string }
  | { type: 'toggle-collapsed' }
  | { type: 'open-path'; path: string }
  | { type: 'select-file'; path: string }
  | { type: 'toggle-tree' }
  | { type: 'set-annotate'; on: boolean }
  | { type: 'click-content'; mark: string; x: number; y: number }
  | { type: 'dismiss-note' }
  | { type: 'note-enter' }
  | { type: 'note-ctrl-enter' }
  | { type: 'composer-send'; text: string }
  | { type: 'set-note-draft'; text: string }
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
    annotate: boolean
    pendingMark: string | null
    notePos: NotePos | null
    noteDraft: string
  }
  review: ReviewState
  browser: BrowserState
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
}

export type SidebarSession = {
  snapshot(): SidebarSnapshot
  dispatch(intent: Intent): Effect[]
}

export function createSidebarSession(opts: SessionOptions): SidebarSession {
  const saved = opts.persist.load(opts.sessionId)
  let seq = saved ? saved.tabs.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0) : 0
  let attachments: Annotation[] = saved?.attachments ?? []
  let queue: Array<{ text: string; attachments: Annotation[] }> = saved?.queue ?? []
  let collapsed = saved?.collapsed ?? true
  let tabs: Tab[] = saved?.tabs ?? []
  let active = saved?.active ?? null
  let files = saved?.files ?? {
    path: '',
    preview: undefined,
    tree: opts.files.tree(),
    treeOpen: true,
    annotate: false,
    pendingMark: null,
    notePos: null,
    noteDraft: '',
  }
  files = { ...files, tree: opts.files.tree(), preview: files.path ? opts.files.read(files.path) : undefined }
  let review = saved?.review ?? emptyReview()
  let browser = saved?.browser ?? emptyBrowser()
  let terminal = saved?.terminal ?? emptyTerminal()
  let sideChat = saved?.sideChat ?? emptySideChat()

  function nid(): string {
    seq += 1
    return `t${seq}`
  }

  function persist(): void {
    opts.persist.save(opts.sessionId, snapshot())
  }

  function snapshot(): SidebarSnapshot {
    const activeTab = tabs.find((t) => t.id === active)
    const showPalette = !activeTab || activeTab.kind === null
    return {
      sessionId: opts.sessionId,
      collapsed,
      tabs: tabs.map((t) => ({ ...t })),
      active,
      showPalette,
      palette: PALETTE,
      files: { ...files, tree: opts.files.tree(), preview: files.path ? opts.files.read(files.path) : undefined },
      review: { ...review },
      browser: { ...browser },
      terminal: { ...terminal },
      sideChat: { ...sideChat },
      attachments: attachments.map((a) => ({ ...a })),
      queue: queue.map((q) => ({ text: q.text, attachments: q.attachments.map((a) => ({ ...a })) })),
    }
  }

  function expand(): void {
    collapsed = false
  }

  function fillOrOpen(kind: ToolKind, target = ''): void {
    expand()
    if (kind === 'Files' && target) {
      const reuse = tabs.find((t) => t.kind === 'Files' && t.target === target)
      if (reuse) {
        active = reuse.id
        return
      }
    }
    const empty = tabs.find((t) => t.id === active && t.kind === null)
    if (empty) {
      tabs = tabs.map((t) => (t.id === empty.id ? { ...t, kind, title: target ? target.split('/').pop() ?? kind : kind, target } : t))
      return
    }
    const id = nid()
    const tab: Tab = {
      id,
      kind,
      target,
      title: target ? target.split('/').pop() ?? kind : kind,
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
        break
      }
      case 'toggle-collapsed':
        collapsed = !collapsed
        break
      case 'open-path':
        fillOrOpen('Files', intent.path)
        files = { ...files, path: intent.path, pendingMark: null, notePos: null }
        break
      case 'select-file':
        files = { ...files, path: intent.path, pendingMark: null, notePos: null }
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
        const text = files.noteDraft || files.pendingMark
        attachments = [...attachments, { id: nid(), text, from: files.pendingMark }]
        files = { ...files, pendingMark: null, notePos: null, noteDraft: '' }
        break
      }
      case 'note-ctrl-enter': {
        if (!files.pendingMark) break
        const text = files.noteDraft || files.pendingMark
        const payload = [...attachments, { id: nid(), text, from: files.pendingMark }]
        if (opts.isBusy()) {
          queue = [...queue, { text, attachments: payload }]
          effects.push({ type: 'queue', text, attachments: payload })
        } else {
          effects.push({ type: 'send', text, attachments: payload })
        }
        attachments = []
        files = { ...files, pendingMark: null, notePos: null, noteDraft: '' }
        break
      }
      case 'composer-send': {
        const payload = attachments
        if (opts.isBusy()) {
          queue = [...queue, { text: intent.text, attachments: payload }]
          effects.push({ type: 'queue', text: intent.text, attachments: payload })
        } else {
          effects.push({ type: 'send', text: intent.text, attachments: payload })
        }
        attachments = []
        break
      }
      default: {
        const nextReview = reduceReview(review, intent)
        if (nextReview !== undefined) {
          review = nextReview.state
          effects.push(...nextReview.effects)
          break
        }
        const nextBrowser = reduceBrowser(browser, intent)
        if (nextBrowser !== undefined) {
          browser = nextBrowser.state
          effects.push(...nextBrowser.effects)
          break
        }
        const nextTerminal = reduceTerminal(terminal, intent)
        if (nextTerminal !== undefined) {
          terminal = nextTerminal.state
          effects.push(...nextTerminal.effects)
          break
        }
        const nextSideChat = reduceSideChat(sideChat, intent)
        if (nextSideChat !== undefined) {
          sideChat = nextSideChat.state
          effects.push(...nextSideChat.effects)
          break
        }
        break
      }
    }
    persist()
    return effects
  }

  return { snapshot, dispatch }
}
