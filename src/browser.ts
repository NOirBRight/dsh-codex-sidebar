/** Browser 工具: navigable page + 批注. Does not start the project. */

import type { Annotation, AnnotationRect, BrowserEvidence, Effect } from './session.ts'

export type PageElement = {
  selector: string
  text: string
}

export type PageDocument = {
  url: string
  title: string
  html?: string
  elements: PageElement[]
}

export type BrowserStatus = 'empty' | 'loaded' | 'unreachable'
export type BrowserRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'crashed'

export type BrowserDevice = 'fit' | 'phone' | 'tablet' | 'laptop'

export type BrowserDevicePreset = {
  id: BrowserDevice
  label: string
  width?: number
  height?: number
}

export const BROWSER_DEVICE_PRESETS: readonly BrowserDevicePreset[] = [
  { id: 'fit', label: '适应窗口' },
  { id: 'phone', label: '手机 390×844', width: 390, height: 844 },
  { id: 'tablet', label: '平板 768×1024', width: 768, height: 1024 },
  { id: 'laptop', label: '笔记本 1280×800', width: 1280, height: 800 },
]

export function browserDeviceViewport(device: BrowserDevice): { width: number; height: number } | null {
  const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === device)
  return preset?.width === undefined || preset.height === undefined
    ? null
    : { width: preset.width, height: preset.height }
}

export function normalizeBrowserDevice(value: unknown): BrowserDevice {
  return value === 'phone' || value === 'tablet' || value === 'laptop' ? value : 'fit'
}

export type BrowserIntent =
  | { type: 'open-url'; url: string; reveal?: boolean }
  | { type: 'browser-follow'; url: string }
  | { type: 'browser-back' }
  | { type: 'browser-forward' }
  | { type: 'browser-refresh' }
  | { type: 'browser-set-device'; device: BrowserDevice }
  | { type: 'browser-open-external' }
  | { type: 'browser-runtime-sync'; tabId: string; url: string; title: string; documentId: string; status: BrowserRuntimeStatus; error?: string }
  | { type: 'browser-set-annotate'; on: boolean }
  | { type: 'browser-click-content'; mark: string; x: number; y: number; captureId: string; documentId: string; layoutRevision: number; mediaGeneration: number; selector?: string; rect?: AnnotationRect }
  | { type: 'browser-dismiss-note' }
  | { type: 'browser-set-note-draft'; text: string }
  | { type: 'browser-note-add'; evidence?: BrowserEvidence }
  | { type: 'browser-note-send'; evidence?: BrowserEvidence }

export type BrowserPort = {
  load(url: string): PageDocument | undefined
  openExternal(url: string): void
  isBusy(): boolean
  manage?(tabId: string, url: string, action: 'open' | 'back' | 'forward' | 'refresh'): void
  close?(tabId: string): void
  spawn?(command: string): void
}

export type BrowserState = {
  url: string
  draft: string
  status: BrowserStatus
  runtimeStatus: BrowserRuntimeStatus
  device: BrowserDevice
  documentId: string | null
  runtimeError: string | null
  page: PageDocument | null
  history: string[]
  index: number
  canBack: boolean
  canForward: boolean
  canAnnotate: boolean
  annotate: boolean
  pendingMark: string | null
  pendingSelector: string | null
  pendingRect: AnnotationRect | null
  pendingCaptureId: string | null
  pendingDocumentId: string | null
  pendingLayoutRevision: number | null
  pendingMediaGeneration: number | null
  pendingEvidence: BrowserEvidence | null
  notePos: { x: number; y: number } | null
  noteDraft: string
  editingId: string | null
  attachments: Annotation[]
  seq: number
}

export function emptyBrowser(): BrowserState {
  return hydrate({ url: '' })
}

export function rememberBrowser(state: Partial<BrowserState> & { url?: string }): BrowserState {
  return hydrate({ ...state, url: state.url ?? '' })
}

export function hydrateBrowserPages(saved: {
  browser?: BrowserState
  browsers?: Record<string, BrowserState>
  tabs?: Array<{ id: string; kind: string | null }>
  active?: string | null
} | undefined): Record<string, BrowserState> {
  if (saved?.browsers !== undefined && Object.keys(saved.browsers).length > 0) {
    const out: Record<string, BrowserState> = {}
    for (const [id, state] of Object.entries(saved.browsers)) out[id] = rememberBrowser(state)
    return out
  }
  const tabs = saved?.tabs ?? []
  const tab = tabs.find((item) => item.id === saved?.active && item.kind === 'Browser')
    ?? tabs.find((item) => item.kind === 'Browser')
  if (saved?.browser !== undefined && tab !== undefined) return { [tab.id]: rememberBrowser(saved.browser) }
  return {}
}

export function projectBrowser(state: BrowserState, _port?: BrowserPort): BrowserState {
  return flags(hydrate(state))
}


export function syncManagedBrowser(state: BrowserState, projection: {
  url: string
  title: string
  documentId: string
  status: BrowserRuntimeStatus
  error?: string
}): BrowserState {
  const current = hydrate(state)
  const publicUrl = isChromiumErrorUrl(projection.url) ? current.url : projection.url
  const changedDocument = current.documentId !== null && current.documentId !== projection.documentId
  const ready = projection.status === 'ready'
  const failed = projection.status === 'error' || projection.status === 'crashed'
  const changedUrl = publicUrl.length > 0 && managedBrowserHref(publicUrl) !== undefined && publicUrl !== current.url
  const history = changedUrl
    ? [...current.history.slice(0, current.index + 1), publicUrl]
    : current.history
  const index = changedUrl ? history.length - 1 : current.index
  return flags({
    ...current,
    url: publicUrl || current.url,
    draft: publicUrl || current.draft,
    status: ready ? 'loaded' : failed ? 'unreachable' : current.status,
    runtimeStatus: projection.status,
    documentId: projection.documentId,
    runtimeError: projection.error ?? null,
    page: ready ? { url: publicUrl, title: projection.title || publicUrl, elements: [] } : failed ? null : current.page,
    history,
    index,
    ...changedDocument ? {
      annotate: false,
      pendingMark: null,
      pendingSelector: null,
      pendingRect: null,
      pendingCaptureId: null,
      pendingDocumentId: null,
      pendingLayoutRevision: null,
      pendingMediaGeneration: null,
      pendingEvidence: null,
      notePos: null,
      noteDraft: '',
      editingId: null,
    } : {},
  })
}

export function reduceBrowser(
  state: BrowserState,
  intent: { type: string },
  port?: BrowserPort,
): { state: BrowserState; effects: Effect[] } | undefined {
  const current = flags(hydrate(state))
  switch (intent.type) {
    case 'open-url':
    case 'browser-follow': {
      const url = (intent as BrowserIntent & { type: 'open-url' | 'browser-follow' }).url
      return { state: pushUrl(current, url, port), effects: [] }
    }
    case 'browser-back': {
      if (!current.canBack) return { state: current, effects: [] }
      const index = current.index - 1
      const url = current.history[index] ?? ''
      return { state: show(current, url, port, current.history, index), effects: [] }
    }
    case 'browser-forward': {
      if (!current.canForward) return { state: current, effects: [] }
      const index = current.index + 1
      const url = current.history[index] ?? ''
      return { state: show(current, url, port, current.history, index), effects: [] }
    }
    case 'browser-refresh': {
      if (current.url.length === 0) return { state: current, effects: [] }
      return { state: show(current, current.url, port, current.history, current.index), effects: [] }
    }
    case 'browser-set-device': {
      const device = normalizeBrowserDevice((intent as BrowserIntent & { type: 'browser-set-device' }).device)
      return { state: flags({ ...current, device }), effects: [] }
    }
    case 'browser-open-external': {
      const external = externalBrowserHref(current.url)
      if (external !== undefined) port?.openExternal(external)
      return { state: current, effects: [] }
    }
    case 'browser-set-annotate': {
      const on = (intent as BrowserIntent & { type: 'browser-set-annotate' }).on
      if (!current.canAnnotate || !on) {
        return {
          state: flags({
            ...current,
            annotate: false,
            pendingMark: null,
            pendingSelector: null,
            pendingRect: null,
            pendingCaptureId: null,
            pendingDocumentId: null,
            pendingLayoutRevision: null,
            pendingMediaGeneration: null,
            pendingEvidence: null,
            notePos: null,
            noteDraft: '',
            editingId: null,
          }),
          effects: [],
        }
      }
      return { state: flags({ ...current, annotate: true }), effects: [] }
    }
    case 'browser-click-content': {
      if (!current.annotate || current.status !== 'loaded') return { state: current, effects: [] }
      const click = intent as BrowserIntent & { type: 'browser-click-content' }
      if (typeof click.captureId !== 'string' || click.captureId.length === 0 || typeof click.documentId !== 'string' || click.documentId.length === 0
        || !Number.isSafeInteger(click.layoutRevision) || click.layoutRevision <= 0
        || !Number.isSafeInteger(click.mediaGeneration) || click.mediaGeneration <= 0) {
        return { state: current, effects: [] }
      }
      const mark = click.mark
      const x = click.x
      const y = click.y
      const selector = click.selector
      const rect = click.rect
      return {
        state: flags({
          ...current,
          pendingMark: mark,
          pendingSelector: selector ?? null,
          pendingRect: rect ?? null,
          pendingCaptureId: click.captureId,
          pendingDocumentId: click.documentId,
          pendingLayoutRevision: click.layoutRevision,
          pendingMediaGeneration: click.mediaGeneration,
          pendingEvidence: null,
          notePos: { x, y },
          noteDraft: '',
          editingId: null,
        }),
        effects: [],
      }
    }
    case 'browser-set-note-draft': {
      const text = (intent as BrowserIntent & { type: 'browser-set-note-draft' }).text
      return { state: flags({ ...current, noteDraft: text }), effects: [] }
    }
    case 'browser-dismiss-note':
      return {
        state: flags({
          ...current,
          pendingMark: null,
          pendingSelector: null,
          pendingRect: null,
          pendingCaptureId: null,
          pendingDocumentId: null,
          pendingLayoutRevision: null,
          pendingMediaGeneration: null,
          pendingEvidence: null,
          notePos: null,
          noteDraft: '',
          editingId: null,
        }),
        effects: [],
      }
    default:
      return undefined
  }
}

function hydrate(state: Partial<BrowserState> & { url: string }): BrowserState {
  return {
    url: state.url,
    draft: state.draft ?? state.url,
    status: state.status ?? (state.url.length === 0 ? 'empty' : 'unreachable'),
    runtimeStatus: state.runtimeStatus ?? 'idle',
    device: normalizeBrowserDevice(state.device),
    documentId: state.documentId ?? null,
    runtimeError: state.runtimeError ?? null,
    page: state.page ?? null,
    history: state.history ?? [],
    index: state.index ?? -1,
    canBack: false,
    canForward: false,
    canAnnotate: false,
    annotate: state.annotate ?? false,
    pendingMark: state.pendingMark ?? null,
    pendingSelector: state.pendingSelector ?? null,
    pendingRect: state.pendingRect ?? null,
    pendingCaptureId: state.pendingCaptureId ?? null,
    pendingDocumentId: state.pendingDocumentId ?? null,
    pendingLayoutRevision: state.pendingLayoutRevision ?? null,
    pendingMediaGeneration: state.pendingMediaGeneration ?? null,
    pendingEvidence: state.pendingEvidence ?? null,
    notePos: state.notePos ?? null,
    noteDraft: state.noteDraft ?? '',
    editingId: state.editingId ?? null,
    attachments: state.attachments ?? [],
    seq: state.seq ?? 0,
  }
}

function flags(state: BrowserState): BrowserState {
  return {
    ...state,
    canBack: state.index > 0,
    canForward: state.index >= 0 && state.index < state.history.length - 1,
    canAnnotate: state.status === 'loaded',
  }
}

function pushUrl(state: BrowserState, url: string, port?: BrowserPort): BrowserState {
  const loaded = loadPage(url, port)
  if (loaded.url.length > 0 && loaded.url === state.url && state.index >= 0) {
    return show(state, loaded.url, port, state.history, state.index)
  }
  if (loaded.url.length === 0) {
    return show(state, '', port, state.history, state.index)
  }
  const history = [...state.history.slice(0, state.index + 1), loaded.url]
  return show(state, loaded.url, port, history, history.length - 1)
}

function show(
  state: BrowserState,
  url: string,
  port: BrowserPort | undefined,
  history: string[],
  index: number,
): BrowserState {
  const loaded = loadPage(url, port)
  return flags({
    ...state,
    ...loaded,
    history,
    index,
    annotate: false,
    pendingMark: null,
    pendingSelector: null,
    pendingRect: null,
    pendingCaptureId: null,
    pendingDocumentId: null,
    pendingLayoutRevision: null,
    pendingMediaGeneration: null,
    pendingEvidence: null,
    notePos: null,
    noteDraft: '',
    editingId: null,
  })
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^(mailto|data|blob|about|javascript):/i.test(trimmed)) return trimmed
  if (
    /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed)
    || /^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)
  ) {
    return `http://${trimmed}`
  }
  if (/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

export function liveHref(url: string): string | undefined {
  const href = normalizeUrl(url)
  return /^https?:\/\//i.test(href) ? href : undefined
}

/** Address that may be opened outside the Host-managed Browser. */
export function externalBrowserHref(url: string): string | undefined {
  return liveHref(url)
}

/** HTTP(S) or syntactically valid absolute local HTML address for managed Chromium. */
export function managedBrowserHref(url: string): string | undefined {
  const href = normalizeUrl(url)
  const external = liveHref(href)
  if (external !== undefined) return external
  if (!/^file:\/\/\/(?!\/)/i.test(href)) return undefined
  let parsed: URL
  try { parsed = new URL(href) } catch { return undefined }
  if (parsed.protocol !== 'file:' || parsed.host.length > 0 || parsed.username.length > 0 || parsed.password.length > 0) return undefined
  let path: string
  try { path = decodeURIComponent(parsed.pathname) } catch { return undefined }
  return path.startsWith('/') && /\.html?$/i.test(path) ? parsed.href : undefined
}

/** Chromium's failed-navigation page. Never treat this as the address the human asked for. */
export function isChromiumErrorUrl(url: string): boolean {
  return /^chrome-error:/i.test(url.trim())
}

/** 主会话 path takeover: http(s), loopback, and `example.com` — never `README.md`. */
export function isTakeoverUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)) return true
  if (isWorkspacePath(trimmed)) return false
  return /^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(trimmed)
}

const FILE_EXT = /^(tsx?|jsx?|mjs|cjs|md|json|css|html?|vue|svelte|py|rs|go|toml|ya?ml|svg|png|jpe?g|gif|webp|txt|map|lock)$/i

function isWorkspacePath(raw: string): boolean {
  if (raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('~')) return true
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true
  const noQuery = raw.split(/[?#]/)[0] ?? raw
  const first = (noQuery.split('/')[0] ?? '').split(':')[0] ?? ''
  if (looksLikeHost(first)) return false
  if (noQuery.includes('/') || noQuery.includes('\\')) return true
  const base = noQuery.split(/[\\/]/).pop() ?? noQuery
  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : ''
  return ext.length > 0 && FILE_EXT.test(ext)
}

function looksLikeHost(part: string): boolean {
  if (/^(localhost|127\.0\.0\.1)$/i.test(part)) return true
  if (!/^[\w.-]+\.[a-z]{2,}$/i.test(part)) return false
  const tld = part.split('.').pop() ?? ''
  return !FILE_EXT.test(tld)
}


function loadPage(url: string, port?: BrowserPort): Pick<BrowserState, 'url' | 'draft' | 'status' | 'page'> {
  const trimmed = normalizeUrl(url.trim())
  if (trimmed.length === 0) {
    return { url: '', draft: '', status: 'empty', page: null }
  }
  const page = port?.load(trimmed)
  if (page !== undefined) {
    return { url: trimmed, draft: trimmed, status: 'loaded', page }
  }
  // http(s) is for the iframe to try. A failed snapshot probe is not "no service".
  if (port === undefined || managedBrowserHref(trimmed) !== undefined) {
    return {
      url: trimmed,
      draft: trimmed,
      status: 'loaded',
      page: { url: trimmed, title: trimmed, elements: [{ selector: 'body', text: trimmed }] },
    }
  }
  return { url: trimmed, draft: trimmed, status: 'unreachable', page: null }
}
