import { describe, expect, it } from 'vitest'
import { formatDelivery } from '../src/send-text.ts'
import { createSidebarSession } from '../src/session.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'
import type {
  DeliverResult, LogEvent, RosterEntry, SideChatPort, SourcedDelivery,
} from '../src/side-chat.ts'

const LOGIN = 'export function Login() {\n  return <h1>Sign in</h1>\n}'

const IN_FLIGHT: LogEvent[] = [
  { seq: 1, turn: 1, role: 'user', text: 'fix login' },
  { seq: 2, turn: 1, role: 'assistant', text: 'I will change Login.tsx', closed: true, writes: ['src/Login.tsx'] },
  { seq: 3, turn: 2, role: 'user', text: 'also the button' },
  { seq: 4, turn: 2, role: 'tool-call', text: 'read src/Login.tsx' },
  { seq: 5, turn: 2, role: 'tool-result', text: LOGIN, writes: ['src/Login.tsx'] },
  { seq: 6, turn: 2, role: 'assistant', text: 'halfway through the button', closed: false },
]

const API_LOG: LogEvent[] = [
  { seq: 1, turn: 1, role: 'user', text: 'push the schema' },
  { seq: 2, turn: 1, role: 'assistant', text: '已推 API schema', closed: true, writes: ['internal/api.go'] },
]

const ROSTER: RosterEntry[] = [
  { id: 'sess-a', title: 'Run login', cwd: '/foo', kind: 'main', archived: false, busy: true },
  { id: 'sess-b', title: 'API 改动', cwd: '/bar', kind: 'main', archived: false, busy: false },
  { id: 'sess-c', title: 'docs site', cwd: '/docs', kind: 'main', archived: false, busy: false },
  { id: 'sess-old', title: 'old login', cwd: '/old', kind: 'main', archived: true, busy: false },
  { id: 'sub-1', title: 'login helper', cwd: '/foo', kind: 'subagent', archived: false, busy: true },
  { id: 'side-1', title: 'Side Chat of A', cwd: '/foo', kind: 'side-chat', archived: false, busy: false },
]

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

function fakePort(opts?: {
  logs?: Record<string, LogEvent[]>
  files?: Record<string, string>
  deliver?: (payload: SourcedDelivery) => DeliverResult
}): SideChatPort & { delivered: SourcedDelivery[] } {
  const logs = opts?.logs ?? { 'sess-a': [...IN_FLIGHT], 'sess-b': [...API_LOG] }
  const files = opts?.files ?? { 'src/Login.tsx': LOGIN, 'README.md': '# foo\n' }
  const delivered: SourcedDelivery[] = []
  return {
    attachedId: 'sess-a',
    delivered,
    log(sessionId) {
      return logs[sessionId] ?? []
    },
    roster() {
      return ROSTER.map((row) => ({ ...row }))
    },
    read(path) {
      return files[path]
    },
    search(query) {
      const needle = query.toLowerCase()
      return Object.entries(files)
        .filter(([, text]) => text.toLowerCase().includes(needle))
        .map(([path, text]) => ({ path, text }))
    },
    deliver(payload) {
      delivered.push(payload)
      if (opts?.deliver !== undefined) return opts.deliver(payload)
      const target = ROSTER.find((row) => row.id === payload.to)
      if (target === undefined) return { ok: false, error: 'unknown' }
      if (target.archived) return { ok: false, error: 'archived' }
      if (target.kind !== 'main') return { ok: false, error: 'rejected' }
      return { ok: true, queued: target.busy }
    },
  }
}

function session(port: SideChatPort, persist: PersistPort = memoryPersist()) {
  return createSidebarSession({
    sessionId: 'sess-a',
    files: memoryFiles({ 'src/Login.tsx': LOGIN, 'README.md': '# foo\n' }),
    persist,
    isBusy: () => false,
    sideChat: port,
  })
}

function openSide(box: ReturnType<typeof createSidebarSession>): string {
  box.dispatch({ type: 'pick-tool', kind: 'Side Chat' })
  const id = box.snapshot().active
  if (id === null) throw new Error('expected a Side Chat Tab')
  return id
}

function tabOf(box: ReturnType<typeof createSidebarSession>, tabId: string) {
  const tab = box.snapshot().sideChat.byTab[tabId]
  if (tab === undefined) throw new Error(`expected Side Chat state for ${tabId}`)
  return tab
}

describe('Side Chat seam', () => {
  it('leaves an opened Tab with no Fork until the first send', () => {
    const box = session(fakePort())
    const tabId = openSide(box)
    const snap = box.snapshot().sideChat.byTab?.[tabId]
    expect(snap === undefined || snap.forked === false).toBe(true)
    expect(snap?.fork ?? []).toEqual([])
    expect(snap?.messages ?? []).toEqual([])
  })

  it('Forks completed turns plus in-flight tools on first send, and omits the unfinished final reply', () => {
    const box = session(fakePort())
    const tabId = openSide(box)
    const effects = box.dispatch({ type: 'side-send', tabId, text: 'what is this turn doing?' })
    expect(effects).toEqual([{
      type: 'side-ask',
      tabId,
      text: 'what is this turn doing?',
      atSeq: 5,
    }])
    const tab = tabOf(box, tabId)
    expect(tab.forked).toBe(true)
    expect(tab.fork.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(tab.forkSeq).toBe(5)
    expect(tab.fork.some((event) => event.closed === false)).toBe(false)
    expect(tab.messages.some((msg) => msg.kind === 'user' && msg.text === 'what is this turn doing?')).toBe(true)
    expect(tab.messages.some((msg) => msg.kind === 'side' && msg.text === '正在回答…')).toBe(true)
  })

  it('does not rewrite the Fork on a follow-up after the 主会话 log grows', () => {
    const logs: Record<string, LogEvent[]> = { 'sess-a': [...IN_FLIGHT], 'sess-b': [...API_LOG] }
    const box = session(fakePort({ logs }))
    const tabId = openSide(box)
    box.dispatch({ type: 'side-send', tabId, text: 'why Login?' })
    logs['sess-a'] = [
      ...IN_FLIGHT.slice(0, 5),
      { seq: 6, turn: 2, role: 'assistant', text: 'button is done', closed: true },
      { seq: 7, turn: 3, role: 'user', text: 'now tests' },
    ]
    box.dispatch({ type: 'side-send', tabId, text: 'still that moment?' })
    const tab = tabOf(box, tabId)
    expect(tab.forkSeq).toBe(5)
    expect(tab.fork.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(tab.messages.filter((msg) => msg.kind === 'user')).toHaveLength(2)
  })

  it('cuts a new Fork for a new Side Chat Tab', () => {
    const logs: Record<string, LogEvent[]> = { 'sess-a': [...IN_FLIGHT], 'sess-b': [...API_LOG] }
    const box = session(fakePort({ logs }))
    const first = openSide(box)
    box.dispatch({ type: 'side-send', tabId: first, text: 'about the freeze' })
    logs['sess-a'] = [
      ...IN_FLIGHT.slice(0, 5),
      { seq: 6, turn: 2, role: 'assistant', text: 'button is done', closed: true },
      { seq: 7, turn: 3, role: 'user', text: 'now tests' },
      { seq: 8, turn: 3, role: 'tool-call', text: 'read tests/login.spec.ts' },
    ]
    box.dispatch({ type: 'open-empty-tab' })
    box.dispatch({ type: 'pick-tool', kind: 'Side Chat' })
    const second = box.snapshot().active as string
    expect(second).not.toBe(first)
    box.dispatch({ type: 'side-send', tabId: second, text: 'ask about now' })
    expect(tabOf(box, first).forkSeq).toBe(5)
    expect(tabOf(box, second).fork.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(tabOf(box, second).forkSeq).toBe(8)
  })

  it('列出 is profile-wide 主会话s only: any cwd, no subagents, no Side Chats, no archived', () => {
    const box = session(fakePort())
    const tabId = openSide(box)
    box.dispatch({ type: 'side-list', tabId })
    expect(tabOf(box, tabId).listed).toEqual([
      { id: 'sess-a', title: 'Run login', cwd: '/foo', busy: true },
      { id: 'sess-b', title: 'API 改动', cwd: '/bar', busy: false },
      { id: 'sess-c', title: 'docs site', cwd: '/docs', busy: false },
    ])
    box.dispatch({ type: 'side-list', tabId, phrase: 'API' })
    expect(tabOf(box, tabId).listed).toEqual([
      { id: 'sess-b', title: 'API 改动', cwd: '/bar', busy: false },
    ])
    box.dispatch({ type: 'side-list', tabId, phrase: 'bar' })
    expect(tabOf(box, tabId).listed?.map((row) => row.id)).toEqual(['sess-b'])
  })

  it('察看 yields a 进度卡片 and does not unfreeze the Fork', () => {
    const box = session(fakePort())
    const tabId = openSide(box)
    box.dispatch({ type: 'side-send', tabId, text: 'what is happening?' })
    const before = tabOf(box, tabId).fork.map((event) => event.seq)
    const effects = box.dispatch({ type: 'side-inspect', tabId, sessionId: 'sess-a' })
    expect(effects).toEqual([])
    const tab = tabOf(box, tabId)
    expect(tab.fork.map((event) => event.seq)).toEqual(before)
    expect(tab.forked).toBe(true)
    expect(tab.card).toEqual({
      sessionId: 'sess-a',
      title: 'Run login',
      busy: true,
      turn: 2,
      step: 1,
      last: 'I will change Login.tsx',
      files: ['src/Login.tsx'],
    })
  })

  it('投递 is sourced, not a user-role Effect, including to the current 主会话', () => {
    const port = fakePort()
    const box = session(port)
    const tabId = openSide(box)
    const idle = box.dispatch({
      type: 'side-deliver',
      tabId,
      sessionId: 'sess-b',
      text: 'use this login plan',
    })
    expect(idle).toEqual([{
      type: 'deliver',
      to: 'sess-b',
      text: 'use this login plan',
      sourceTab: tabId,
      sourceSession: 'sess-a',
    }])
    expect(port.delivered[0]).toEqual({
      role: 'sourced',
      to: 'sess-b',
      text: 'use this login plan',
      sourceTab: tabId,
      sourceSession: 'sess-a',
    })
    expect(tabOf(box, tabId).messages.some((msg) => (
      msg.kind === 'delivery' && msg.to === 'sess-b' && msg.status === 'sent'
    ))).toBe(true)

    const busy = box.dispatch({
      type: 'side-deliver',
      tabId,
      sessionId: 'sess-a',
      text: 'hand this back',
    })
    expect(busy).toEqual([{
      type: 'deliver',
      to: 'sess-a',
      text: 'hand this back',
      sourceTab: tabId,
      sourceSession: 'sess-a',
    }])
    expect(port.delivered[1]).toEqual({
      role: 'sourced',
      to: 'sess-a',
      text: 'hand this back',
      sourceTab: tabId,
      sourceSession: 'sess-a',
    })
    expect(tabOf(box, tabId).messages.some((msg) => (
      msg.kind === 'delivery' && msg.to === 'sess-a' && msg.status === 'queued'
    ))).toBe(true)
  })

  it('keeps a failed 投递 visible in Side Chat', () => {
    const port = fakePort()
    const box = session(port)
    const tabId = openSide(box)
    expect(box.dispatch({
      type: 'side-deliver',
      tabId,
      sessionId: 'nope',
      text: 'hello missing 舵主',
    })).toEqual([])
    expect(box.dispatch({
      type: 'side-deliver',
      tabId,
      sessionId: 'sess-old',
      text: 'hello archive',
    })).toEqual([])
    expect(box.dispatch({
      type: 'side-deliver',
      tabId,
      sessionId: 'sub-1',
      text: 'hello subagent',
    })).toEqual([])
    const failures = tabOf(box, tabId).messages.filter((msg) => msg.kind === 'delivery' && msg.status === 'failed')
    expect(failures).toEqual([
      { kind: 'delivery', to: 'nope', text: 'hello missing 舵主', status: 'failed', error: 'unknown' },
      { kind: 'delivery', to: 'sess-old', text: 'hello archive', status: 'failed', error: 'archived' },
      { kind: 'delivery', to: 'sub-1', text: 'hello subagent', status: 'failed', error: 'rejected' },
    ])
  })

  it('allows read and search against the live workspace after the Fork is frozen', () => {
    const files = { 'src/Login.tsx': LOGIN, 'README.md': '# foo\n' }
    const box = session(fakePort({ files }))
    const tabId = openSide(box)
    box.dispatch({ type: 'side-send', tabId, text: 'check the file' })
    files['src/Login.tsx'] = 'export function Login() {\n  return <h1>Welcome</h1>\n}'
    expect(box.dispatch({ type: 'side-read', tabId, path: 'src/Login.tsx' })).toEqual([])
    const tab = tabOf(box, tabId)
    expect(tab.forked).toBe(true)
    expect(tab.error).toBeNull()
    expect(tab.messages.some((msg) => (
      msg.kind === 'read' && msg.path === 'src/Login.tsx' && msg.text.includes('Welcome')
    ))).toBe(true)
    box.dispatch({ type: 'side-search', tabId, query: 'Welcome' })
    expect(tabOf(box, tabId).messages.some((msg) => (
      msg.kind === 'search' && msg.query === 'Welcome' && msg.hits.some((hit) => hit.path === 'src/Login.tsx')
    ))).toBe(true)
  })

  it('rejects write, pty, and spawn with an error in state and no write effects', () => {
    const files = { 'src/Login.tsx': LOGIN }
    const box = session(fakePort({ files }))
    const tabId = openSide(box)
    expect(box.dispatch({ type: 'side-write', tabId, path: 'src/Login.tsx', text: 'hacked' })).toEqual([])
    expect(tabOf(box, tabId).error).toBe('Side Chat cannot write')
    expect(files['src/Login.tsx']).toBe(LOGIN)
    expect(box.dispatch({ type: 'side-pty', tabId, command: 'rm -rf /' })).toEqual([])
    expect(tabOf(box, tabId).error).toBe('Side Chat cannot run Terminal')
    expect(box.dispatch({ type: 'side-spawn', tabId })).toEqual([])
    expect(tabOf(box, tabId).error).toBe('Side Chat cannot spawn')
    expect(files['src/Login.tsx']).toBe(LOGIN)
  })

  it('persists Fork seq and transcript with the 主会话', () => {
    const persist = memoryPersist()
    const port = fakePort()
    const box = session(port, persist)
    const tabId = openSide(box)
    box.dispatch({ type: 'side-send', tabId, text: 'freeze this' })
    const again = session(port, persist)
    const tab = tabOf(again, tabId)
    expect(tab.forked).toBe(true)
    expect(tab.forkSeq).toBe(5)
    expect(tab.messages.some((msg) => msg.kind === 'user' && msg.text === 'freeze this')).toBe(true)
  })

  it('labels a 投递 so the 主会话 can see it is not a user message', () => {
    expect(formatDelivery('use this login plan', 't1', 'sess-a')).toBe(
      '[投递 · Side Chat t1 · 主会话 sess-a]\nuse this login plan',
    )
  })
})
