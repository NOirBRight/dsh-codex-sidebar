/** Browser 工具: navigable page + 批注. Does not start the project. */

import type { Annotation, Effect } from './session.ts'

export type PageElement = {
  selector: string
  text: string
}

export type PageDocument = {
  url: string
  title: string
  elements: PageElement[]
}

export type BrowserStatus = 'empty' | 'loaded' | 'unreachable'

export type BrowserIntent =
  | { type: 'open-url'; url: string }
  | { type: 'browser-back' }
  | { type: 'browser-forward' }
  | { type: 'browser-refresh' }
  | { type: 'browser-open-external' }
  | { type: 'browser-set-annotate'; on: boolean }
  | { type: 'browser-click-content'; mark: string; x: number; y: number }
  | { type: 'browser-dismiss-note' }
  | { type: 'browser-set-note-draft'; text: string }
  | { type: 'browser-note-enter' }
  | { type: 'browser-note-ctrl-enter' }

export type BrowserPort = {
  load(url: string): PageDocument | undefined
  openExternal(url: string): void
  isBusy(): boolean
  spawn?(command: string): void
}

export type BrowserState = {
  url: string
  draft: string
  status: BrowserStatus
  page: PageDocument | null
  history: string[]
  index: number
  canBack: boolean
  canForward: boolean
  canAnnotate: boolean
  annotate: boolean
  pendingMark: string | null
  notePos: { x: number; y: number } | null
  noteDraft: string
  attachments: Annotation[]
  seq: number
}

export function emptyBrowser(): BrowserState {
  return hydrate({ url: '' })
}

export function projectBrowser(state: BrowserState, _port?: BrowserPort): BrowserState {
  return flags(hydrate(state))
}

export function reduceBrowser(
  state: BrowserState,
  intent: { type: string },
  port?: BrowserPort,
): { state: BrowserState; effects: Effect[] } | undefined {
  const current = flags(hydrate(state))
  switch (intent.type) {
    case 'open-url': {
      const url = (intent as BrowserIntent & { type: 'open-url' }).url
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
    case 'browser-open-external': {
      if (current.url.length > 0) port?.openExternal(current.url)
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
            notePos: null,
            noteDraft: '',
          }),
          effects: [],
        }
      }
      return { state: flags({ ...current, annotate: true }), effects: [] }
    }
    case 'browser-click-content': {
      if (!current.annotate || current.status !== 'loaded') return { state: current, effects: [] }
      const mark = (intent as BrowserIntent & { type: 'browser-click-content' }).mark
      const x = (intent as BrowserIntent & { type: 'browser-click-content' }).x
      const y = (intent as BrowserIntent & { type: 'browser-click-content' }).y
      return {
        state: flags({
          ...current,
          pendingMark: mark,
          notePos: { x, y },
          noteDraft: '',
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
        state: flags({ ...current, pendingMark: null, notePos: null, noteDraft: '' }),
        effects: [],
      }
    case 'browser-note-enter': {
      if (current.pendingMark === null) return { state: current, effects: [] }
      const text = current.noteDraft || current.pendingMark
      const seq = current.seq + 1
      return {
        state: flags({
          ...current,
          seq,
          attachments: [...current.attachments, { id: `b${seq}`, text, from: current.pendingMark }],
          pendingMark: null,
          notePos: null,
          noteDraft: '',
        }),
        effects: [],
      }
    }
    case 'browser-note-ctrl-enter': {
      if (current.pendingMark === null) return { state: current, effects: [] }
      const text = current.noteDraft || current.pendingMark
      const seq = current.seq + 1
      const payload = [...current.attachments, { id: `b${seq}`, text, from: current.pendingMark }]
      const next = flags({
        ...current,
        seq,
        attachments: [],
        pendingMark: null,
        notePos: null,
        noteDraft: '',
      })
      if (port?.isBusy()) {
        return { state: next, effects: [{ type: 'queue', text, attachments: payload }] }
      }
      return { state: next, effects: [{ type: 'send', text, attachments: payload }] }
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
    page: state.page ?? null,
    history: state.history ?? [],
    index: state.index ?? -1,
    canBack: false,
    canForward: false,
    canAnnotate: false,
    annotate: state.annotate ?? false,
    pendingMark: state.pendingMark ?? null,
    notePos: state.notePos ?? null,
    noteDraft: state.noteDraft ?? '',
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
    notePos: null,
    noteDraft: '',
  })
}

function loadPage(url: string, port?: BrowserPort): Pick<BrowserState, 'url' | 'draft' | 'status' | 'page'> {
  const trimmed = url.trim()
  if (trimmed.length === 0) {
    return { url: '', draft: '', status: 'empty', page: null }
  }
  const page = port?.load(trimmed)
  if (page !== undefined) {
    return { url: trimmed, draft: trimmed, status: 'loaded', page }
  }
  if (port === undefined) {
    return {
      url: trimmed,
      draft: trimmed,
      status: 'loaded',
      page: { url: trimmed, title: trimmed, elements: [{ selector: 'body', text: trimmed }] },
    }
  }
  return { url: trimmed, draft: trimmed, status: 'unreachable', page: null }
}
