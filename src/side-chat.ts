/** Side Chat 工具: frozen Fork, 列出 / 察看 / 投递, read-only workspace. */

import type { Effect } from './session.ts'

export type LogEvent = {
  seq: number
  turn: number
  role: 'user' | 'assistant' | 'tool-call' | 'tool-result'
  text: string
  closed?: boolean
  writes?: string[]
  before?: string
  after?: string
}

export type RosterKind = 'main' | 'subagent' | 'side-chat'

export type RosterEntry = {
  id: string
  title: string
  cwd: string
  kind: RosterKind
  archived: boolean
  busy: boolean
}

export type ListedMain = {
  id: string
  title: string
  cwd: string
  busy: boolean
}

export type ProgressCard = {
  sessionId: string
  title: string
  busy: boolean
  turn: number
  step: number
  last: string
  files: string[]
}

export type SearchHit = {
  path: string
  text: string
}

export type SideChatMessage =
  | { kind: 'user'; text: string }
  | { kind: 'side'; text: string }
  | { kind: 'read'; path: string; text: string }
  | { kind: 'search'; query: string; hits: SearchHit[] }
  | { kind: 'delivery'; to: string; text: string; status: 'sent' | 'queued' }
  | { kind: 'delivery'; to: string; text: string; status: 'failed'; error: string }

export type SideChatTabState = {
  forked: boolean
  forkSeq: number | null
  forkSessionId: string | null
  fork: LogEvent[]
  messages: SideChatMessage[]
  listed: ListedMain[] | null
  card: ProgressCard | null
  error: string | null
  draft: string
}

export type SideChatState = {
  byTab: Record<string, SideChatTabState>
}

export type SourcedDelivery = {
  role: 'sourced'
  to: string
  text: string
  sourceTab: string
  sourceSession: string
}

export type DeliverResult =
  | { ok: true; queued: boolean }
  | { ok: false; error: string }

export type SideChatPort = {
  attachedId: string
  log(sessionId: string): LogEvent[]
  roster(): RosterEntry[]
  read(path: string): string | undefined
  search(query: string): SearchHit[]
  deliver(payload: SourcedDelivery): DeliverResult
}

export type SideChatIntent =
  | { type: 'side-send'; tabId: string; text: string }
  | { type: 'side-list'; tabId: string; phrase?: string }
  | { type: 'side-inspect'; tabId: string; sessionId: string }
  | { type: 'side-deliver'; tabId: string; sessionId: string; text: string }
  | { type: 'side-read'; tabId: string; path: string }
  | { type: 'side-search'; tabId: string; query: string }
  | { type: 'side-write'; tabId: string; path: string; text: string }
  | { type: 'side-pty'; tabId: string; command: string }
  | { type: 'side-spawn'; tabId: string }
  | { type: 'side-draft'; tabId: string; text: string }
  | { type: 'side-bind-fork'; tabId: string; sessionId: string }
  | { type: 'side-reply'; tabId: string; text: string }

const SIDE_TYPES = new Set<string>([
  'side-send',
  'side-list',
  'side-inspect',
  'side-deliver',
  'side-read',
  'side-search',
  'side-write',
  'side-pty',
  'side-spawn',
  'side-draft',
  'side-bind-fork',
  'side-reply',
])

export function emptySideChat(): SideChatState {
  return { byTab: {} }
}

export function emptySideTab(): SideChatTabState {
  return {
    forked: false,
    forkSeq: null,
    forkSessionId: null,
    fork: [],
    messages: [],
    listed: null,
    card: null,
    error: null,
    draft: '',
  }
}

export function projectSideChat(state: SideChatState, _port?: SideChatPort): SideChatState {
  return cloneState(normalize(state))
}

export function reduceSideChat(
  state: SideChatState,
  intent: { type: string },
  port?: SideChatPort,
): { state: SideChatState; effects: Effect[] } | undefined {
  if (!SIDE_TYPES.has(intent.type)) return undefined
  const current = normalize(state)
  if (intent.type === 'side-deliver') {
    return deliver(current, intent as Extract<SideChatIntent, { type: 'side-deliver' }>, port)
  }
  if (intent.type === 'side-send') {
    return send(current, intent as Extract<SideChatIntent, { type: 'side-send' }>, port)
  }
  return { state: reduceKnown(current, intent as SideChatIntent, port), effects: [] }
}

function reduceKnown(state: SideChatState, intent: SideChatIntent, port?: SideChatPort): SideChatState {
  switch (intent.type) {
    case 'side-draft':
      return patchTab(state, intent.tabId, (tab) => ({ ...tab, draft: intent.text }))
    case 'side-send':
      return send(state, intent, port).state
    case 'side-bind-fork':
      return patchTab(state, intent.tabId, (tab) => ({ ...tab, forkSessionId: intent.sessionId, error: null }))
    case 'side-reply':
      return reply(state, intent)
    case 'side-list':
      return listSessions(state, intent, port)
    case 'side-inspect':
      return inspect(state, intent, port)
    case 'side-deliver':
      return deliver(state, intent, port).state
    case 'side-read':
      return readFile(state, intent, port)
    case 'side-search':
      return searchFiles(state, intent, port)
    case 'side-write':
      return patchTab(state, intent.tabId, (tab) => ({ ...tab, error: 'Side Chat cannot write' }))
    case 'side-pty':
      return patchTab(state, intent.tabId, (tab) => ({ ...tab, error: 'Side Chat cannot run Terminal' }))
    case 'side-spawn':
      return patchTab(state, intent.tabId, (tab) => ({ ...tab, error: 'Side Chat cannot spawn' }))
  }
}

export const PENDING_REPLY = '正在回答…'

function send(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-send' }>,
  port?: SideChatPort,
): { state: SideChatState; effects: Effect[] } {
  const text = intent.text.trim()
  if (text.length === 0) return { state, effects: [] }
  const next = patchTab(state, intent.tabId, (tab) => {
    const first = !tab.forked
    const fork = first ? cutFork(port?.log(port.attachedId) ?? []) : tab.fork
    const forkSeq = first ? lastSeq(fork) : tab.forkSeq
    return {
      ...tab,
      forked: true,
      fork,
      forkSeq,
      draft: '',
      error: null,
      messages: [...tab.messages, { kind: 'user', text }, { kind: 'side', text: PENDING_REPLY }],
    }
  })
  const tab = next.byTab[intent.tabId]
  return {
    state: next,
    effects: [{ type: 'side-ask', tabId: intent.tabId, text, atSeq: tab?.forkSeq ?? null }],
  }
}

function reply(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-reply' }>,
): SideChatState {
  return patchTab(state, intent.tabId, (tab) => {
    const messages = [...tab.messages]
    const last = messages[messages.length - 1]
    if (last?.kind === 'side') messages[messages.length - 1] = { kind: 'side', text: intent.text }
    else messages.push({ kind: 'side', text: intent.text })
    return { ...tab, messages, error: null }
  })
}

function listSessions(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-list' }>,
  port?: SideChatPort,
): SideChatState {
  const listed = mainsOf(port?.roster() ?? [], intent.phrase)
  return patchTab(state, intent.tabId, (tab) => ({ ...tab, listed, error: null }))
}

function inspect(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-inspect' }>,
  port?: SideChatPort,
): SideChatState {
  const roster = port?.roster() ?? []
  const entry = roster.find((row) => row.id === intent.sessionId)
  if (entry !== undefined && entry.kind !== 'main') {
    return patchTab(state, intent.tabId, (tab) => ({ ...tab, error: 'not a 主会话' }))
  }
  const log = port?.log(intent.sessionId) ?? []
  const card = makeCard(intent.sessionId, log, roster)
  return patchTab(state, intent.tabId, (tab) => ({ ...tab, card, error: null }))
}

function deliver(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-deliver' }>,
  port?: SideChatPort,
): { state: SideChatState; effects: Effect[] } {
  const payload: SourcedDelivery = {
    role: 'sourced',
    to: intent.sessionId,
    text: intent.text,
    sourceTab: intent.tabId,
    sourceSession: port?.attachedId ?? '',
  }
  const result = port?.deliver(payload) ?? { ok: false as const, error: 'unavailable' }
  const message: SideChatMessage = result.ok
    ? { kind: 'delivery', to: intent.sessionId, text: intent.text, status: result.queued ? 'queued' : 'sent' }
    : { kind: 'delivery', to: intent.sessionId, text: intent.text, status: 'failed', error: result.error }
  const next = patchTab(state, intent.tabId, (tab) => ({
    ...tab,
    error: null,
    messages: [...tab.messages, message],
  }))
  if (!result.ok) return { state: next, effects: [] }
  return {
    state: next,
    effects: [{
      type: 'deliver',
      to: payload.to,
      text: payload.text,
      sourceTab: payload.sourceTab,
      sourceSession: payload.sourceSession,
    }],
  }
}

function readFile(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-read' }>,
  port?: SideChatPort,
): SideChatState {
  const text = port?.read(intent.path)
  if (text === undefined) {
    return patchTab(state, intent.tabId, (tab) => ({ ...tab, error: 'file not found' }))
  }
  return patchTab(state, intent.tabId, (tab) => ({
    ...tab,
    error: null,
    messages: [...tab.messages, { kind: 'read', path: intent.path, text }],
  }))
}

function searchFiles(
  state: SideChatState,
  intent: Extract<SideChatIntent, { type: 'side-search' }>,
  port?: SideChatPort,
): SideChatState {
  const hits = port?.search(intent.query) ?? []
  return patchTab(state, intent.tabId, (tab) => ({
    ...tab,
    error: null,
    messages: [...tab.messages, { kind: 'search', query: intent.query, hits }],
  }))
}

function cutFork(log: readonly LogEvent[]): LogEvent[] {
  const grouped = new Map<number, LogEvent[]>()
  const order: number[] = []
  for (const event of log) {
    const bucket = grouped.get(event.turn)
    if (bucket === undefined) {
      grouped.set(event.turn, [event])
      order.push(event.turn)
    } else {
      bucket.push(event)
    }
  }
  const out: LogEvent[] = []
  for (const turn of order) {
    const events = grouped.get(turn) ?? []
    const complete = events.some((event) => event.role === 'assistant' && event.closed !== false)
    for (const event of events) {
      if (event.role === 'assistant' && event.closed === false) continue
      if (!complete && event.role === 'assistant') continue
      out.push(cloneEvent(event))
    }
  }
  return out
}

function makeCard(sessionId: string, log: readonly LogEvent[], roster: readonly RosterEntry[]): ProgressCard {
  const entry = roster.find((row) => row.id === sessionId)
  const turn = log.reduce((max, event) => Math.max(max, event.turn), 0)
  const current = log.filter((event) => event.turn === turn)
  const files: string[] = []
  for (const event of current) {
    for (const path of event.writes ?? []) {
      if (!files.includes(path)) files.push(path)
    }
  }
  const last = [...log].reverse().find((event) => event.role === 'assistant' && event.closed !== false)
  const inFlight = current.some((event) => event.role === 'assistant' && event.closed === false)
    || (current.length > 0 && !current.some((event) => event.role === 'assistant' && event.closed !== false))
  return {
    sessionId,
    title: entry?.title ?? sessionId,
    busy: entry?.busy ?? inFlight,
    turn,
    step: current.filter((event) => event.role === 'tool-call').length,
    last: last?.text ?? '',
    files,
  }
}

function mainsOf(roster: readonly RosterEntry[], phrase?: string): ListedMain[] {
  const needle = phrase?.trim().toLowerCase() ?? ''
  return roster
    .filter((row) => row.kind === 'main' && !row.archived)
    .filter((row) => {
      if (needle.length === 0) return true
      return row.title.toLowerCase().includes(needle)
        || row.id.toLowerCase().includes(needle)
        || row.cwd.toLowerCase().includes(needle)
    })
    .map((row) => ({ id: row.id, title: row.title, cwd: row.cwd, busy: row.busy }))
}

function lastSeq(fork: readonly LogEvent[]): number | null {
  const last = fork[fork.length - 1]
  return last === undefined ? null : last.seq
}

function patchTab(
  state: SideChatState,
  tabId: string,
  update: (tab: SideChatTabState) => SideChatTabState,
): SideChatState {
  const current = state.byTab[tabId] ?? emptySideTab()
  return { byTab: { ...state.byTab, [tabId]: update(current) } }
}

function normalize(state: SideChatState): SideChatState {
  return { byTab: state.byTab ?? {} }
}

function cloneState(state: SideChatState): SideChatState {
  const byTab: Record<string, SideChatTabState> = {}
  for (const [id, tab] of Object.entries(state.byTab)) {
    byTab[id] = {
      ...tab,
      forkSessionId: tab.forkSessionId ?? null,
      fork: tab.fork.map(cloneEvent),
      messages: tab.messages.map((msg) => cloneMessage(msg)),
      listed: tab.listed?.map((row) => ({ ...row })) ?? null,
      card: tab.card === null ? null : { ...tab.card, files: [...tab.card.files] },
    }
  }
  return { byTab }
}

function cloneEvent(event: LogEvent): LogEvent {
  return {
    seq: event.seq,
    turn: event.turn,
    role: event.role,
    text: event.text,
    ...event.closed === undefined ? {} : { closed: event.closed },
    ...event.writes === undefined ? {} : { writes: [...event.writes] },
  }
}

function cloneMessage(msg: SideChatMessage): SideChatMessage {
  if (msg.kind === 'search') return { kind: 'search', query: msg.query, hits: msg.hits.map((hit) => ({ ...hit })) }
  if (msg.kind === 'delivery' && msg.status === 'failed') {
    return { kind: 'delivery', to: msg.to, text: msg.text, status: 'failed', error: msg.error }
  }
  if (msg.kind === 'delivery') {
    return { kind: 'delivery', to: msg.to, text: msg.text, status: msg.status }
  }
  return { ...msg }
}
