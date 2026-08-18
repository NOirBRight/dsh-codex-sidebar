import { describe, expect, it } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT } from '../src/contract.ts'
import { handleSidebarRpc } from '../src/host-rpc.ts'
import { createRegistry } from '../src/registry.ts'
import { createSidebarSession, PALETTE } from '../src/session.ts'
import type { FilesPort, Intent, PersistPort } from '../src/session.ts'
import type { ReviewPort } from '../src/review.ts'
import { turnWritesFromLog, turnWritesFromSession } from '../src/turn-writes.ts'

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

function fakeReview(opts?: {
  turn?: Array<{ path: string; before: string; after: string }>
  tree?: Array<{ path: string; before: string; after: string }>
  staged?: Array<{ path: string; before: string; after: string }>
  unstaged?: Array<{ path: string; before: string; after: string }>
  busy?: () => boolean
}): ReviewPort {
  return {
    turnWrites() {
      return opts?.turn ?? []
    },
    workingTree() {
      return opts?.tree ?? []
    },
    staged() {
      return opts?.staged ?? []
    },
    unstaged() {
      return opts?.unstaged ?? []
    },
    isBusy() {
      return opts?.busy?.() ?? false
    },
  }
}

const LOGIN_BEFORE = 'export function Login() {\n  return <button>OK</button>\n}\n'
const LOGIN_AFTER = 'export function Login() {\n  return <h1>Sign in</h1>\n}\n'
const NOTES_AFTER = '# leftover\nlocal scratch — not this turn\n'

const LOGIN_TURN = { path: 'src/Login.tsx', before: LOGIN_BEFORE, after: LOGIN_AFTER }
const NOTES_TREE = { path: 'notes.md', before: '', after: NOTES_AFTER }

function session(review: ReviewPort) {
  return createSidebarSession({
    sessionId: 'sess-a',
    files: memoryFiles({ 'src/Login.tsx': LOGIN_AFTER }),
    persist: memoryPersist(),
    isBusy: () => false,
    review,
  })
}

function gitSpy(port: ReviewPort): ReviewPort & { gitWrites: string[] } {
  const gitWrites: string[] = []
  return {
    ...port,
    gitWrites,
    stage() { gitWrites.push('stage') },
    revert() { gitWrites.push('revert') },
    commit() { gitWrites.push('commit') },
  }
}

describe('Review seam', () => {
  it('opens on 本轮变更, not leftover working-tree files', () => {
    const box = session(fakeReview({
      turn: [LOGIN_TURN],
      tree: [LOGIN_TURN, NOTES_TREE],
    }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    const snap = box.snapshot()
    expect(snap.collapsed).toBe(false)
    expect(snap.showPalette).toBe(false)
    expect(snap.tabs[0]?.kind).toBe('Review')
    expect(snap.palette).toEqual(PALETTE)
    expect(snap.review.mode).toBe('turn')
    expect(snap.review.files.map((file) => file.path)).toEqual(['src/Login.tsx'])
  })

  it('switches to the working tree and shows leftover files the 舵主 did not write this turn', () => {
    const box = session(fakeReview({
      turn: [LOGIN_TURN],
      tree: [LOGIN_TURN, NOTES_TREE],
    }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'review-switch', mode: 'tree' })
    const snap = box.snapshot()
    expect(snap.review.mode).toBe('uncommitted')
    expect(snap.review.files.map((file) => file.path)).toEqual(['src/Login.tsx', 'notes.md'])
  })

  it('keeps an empty 本轮变更 empty instead of falling back to the working tree', () => {
    const box = session(fakeReview({
      turn: [],
      tree: [NOTES_TREE],
    }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    expect(box.snapshot().review.mode).toBe('turn')
    expect(box.snapshot().review.files).toEqual([])
    box.dispatch({ type: 'review-switch', mode: 'tree' })
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['notes.md'])
    box.dispatch({ type: 'review-switch', mode: 'staged' })
    expect(box.snapshot().review.mode).toBe('staged')
    expect(box.snapshot().review.files).toEqual([])
    box.dispatch({ type: 'review-switch', mode: 'unstaged' })
    expect(box.snapshot().review.mode).toBe('unstaged')
    expect(box.snapshot().review.files).toEqual([])
  })

  it('filters staged and unstaged independently of last-turn writes', () => {
    const staged = { path: 'staged.ts', before: 'a\n', after: 'b\n' }
    const unstaged = { path: 'dirty.ts', before: 'c\n', after: 'd\n' }
    const box = session(fakeReview({
      turn: [LOGIN_TURN],
      tree: [LOGIN_TURN, staged, unstaged],
      staged: [staged],
      unstaged: [unstaged],
    }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    expect(box.snapshot().review.scopes.turn.added).toBeGreaterThan(0)
    box.dispatch({ type: 'review-switch', mode: 'staged' })
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['staged.ts'])
    box.dispatch({ type: 'review-switch', mode: 'unstaged' })
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['dirty.ts'])
    box.dispatch({ type: 'review-switch', mode: 'uncommitted' })
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['src/Login.tsx', 'staged.ts', 'dirty.ts'])
  })

  it('lists git branches as a second filter and diffs against the picked ref', () => {
    const vsMain = { path: 'from-main.ts', before: 'old\n', after: 'new\n' }
    const box = session({
      ...fakeReview({ turn: [LOGIN_TURN], tree: [LOGIN_TURN] }),
      branches: () => ({ current: 'work', names: ['main', 'work'] }),
      against: (ref) => ref === 'main' ? [vsMain] : [],
    })
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    expect(box.snapshot().review.branches.names).toEqual(['main', 'work'])
    expect(box.snapshot().review.branch).toBe('work')
    box.dispatch({ type: 'review-set-branch', branch: 'main' })
    box.dispatch({ type: 'review-switch', mode: 'uncommitted' })
    expect(box.snapshot().review.branch).toBe('main')
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['from-main.ts'])
  })

  it('expands a file row into a unified diff and collapses it on a second click', () => {
    const box = session(fakeReview({ turn: [LOGIN_TURN] }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    expect(box.snapshot().review.openDiff).toBeNull()
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    const open = box.snapshot().review.openDiff
    expect(open?.path).toBe('src/Login.tsx')
    expect(open?.hunk.startsWith('@@')).toBe(true)
    expect(open?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'del', text: '  return <button>OK</button>' }),
      expect.objectContaining({ kind: 'add', text: '  return <h1>Sign in</h1>' }),
    ]))
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    expect(box.snapshot().review.openDiff).toBeNull()
  })

  it('does not stage, revert, or commit from Review', () => {
    const review = gitSpy(fakeReview({ turn: [LOGIN_TURN], tree: [LOGIN_TURN, NOTES_TREE] }))
    const box = session(review)
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'review-switch', mode: 'tree' })
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    expect(box.dispatch({ type: 'review-stage' } as Intent)).toEqual([])
    expect(box.dispatch({ type: 'review-revert' } as Intent)).toEqual([])
    expect(box.dispatch({ type: 'review-commit' } as Intent)).toEqual([])
    expect(review.gitWrites).toEqual([])
    expect(box.snapshot().review.files.map((file) => file.path)).toEqual(['src/Login.tsx', 'notes.md'])
  })

  it('stacks a gutter 批注 on Enter and sends it to the 主会话 on Ctrl+Enter', () => {
    const box = session(fakeReview({ turn: [LOGIN_TURN] }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    expect(box.snapshot().review.pendingMark).toBe('src/Login.tsx:2')
    box.dispatch({ type: 'review-set-note-draft', text: 'restore the deleted OK button' })
    expect(box.dispatch({ type: 'review-note-enter' })).toEqual([])
    expect(box.snapshot().attachments).toEqual([
      {
        id: 'r1',
        text: 'restore the deleted OK button',
        from: 'Login.tsx:2',
        source: 'review',
        selector: 'src/Login.tsx:2',
        path: 'src/Login.tsx',
        line: 2,
      },
    ])
    expect(box.snapshot().review.pendingMark).toBeNull()
    expect(box.snapshot().review.attachments).toEqual([])

    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    box.dispatch({ type: 'review-set-note-draft', text: 'keep the Sign in heading' })
    const sent = box.dispatch({ type: 'review-note-ctrl-enter' })
    expect(sent).toEqual([{
      type: 'send',
      text: 'keep the Sign in heading',
      attachments: [
        {
          id: 'r1',
          text: 'restore the deleted OK button',
          from: 'Login.tsx:2',
          source: 'review',
          selector: 'src/Login.tsx:2',
          path: 'src/Login.tsx',
          line: 2,
        },
        {
          id: 'r2',
          text: 'keep the Sign in heading',
          from: 'Login.tsx:2',
          source: 'review',
          selector: 'src/Login.tsx:2',
          path: 'src/Login.tsx',
          line: 2,
        },
      ],
    }])
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().review.attachments).toEqual([])
  })

  it('queues a Review finding when the 主会话 is busy', () => {
    let busy = true
    const box = session(fakeReview({ turn: [LOGIN_TURN], busy: () => busy }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    const queued = box.dispatch({ type: 'review-note-ctrl-enter' })
    expect(queued).toEqual([{
      type: 'queue',
      text: '',
      attachments: [{
        id: 'r1',
        text: '',
        from: 'Login.tsx:2',
        source: 'review',
        selector: 'src/Login.tsx:2',
        path: 'src/Login.tsx',
        line: 2,
      }],
    }])
    busy = false
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    box.dispatch({ type: 'review-set-note-draft', text: 'restore OK' })
    expect(box.dispatch({ type: 'review-note-ctrl-enter' })[0]?.type).toBe('send')
  })

  it('moves the 批注 composer to a later gutter click and dismisses it with Esc', () => {
    const box = session(fakeReview({ turn: [LOGIN_TURN] }))
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'review-toggle-file', path: 'src/Login.tsx' })
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    expect(box.snapshot().review.pendingMark).toBe('src/Login.tsx:2')
    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:3' })
    expect(box.snapshot().review.pendingMark).toBe('src/Login.tsx:3')
    box.dispatch({ type: 'review-dismiss-note' })
    expect(box.snapshot().review.pendingMark).toBeNull()
    expect(box.snapshot().review.noteDraft).toBe('')
  })

  it('reads 本轮变更 from the 主会话 log, not leftover working-tree files', () => {
    const writes = turnWritesFromLog([
      { seq: 1, turn: 1, role: 'user', text: 'fix login' },
      { seq: 2, turn: 1, role: 'tool-result', text: LOGIN_AFTER, writes: ['src/Login.tsx'] },
      { seq: 3, turn: 1, role: 'assistant', text: 'done', closed: true },
    ])
    expect(writes).toEqual([{ path: 'src/Login.tsx', before: '', after: LOGIN_AFTER }])
    expect(turnWritesFromSession({
      messages: [
        { role: 'user', text: 'fix login' },
        { role: 'tool', text: LOGIN_AFTER, writes: ['src/Login.tsx'] },
      ],
    }).map((change) => change.path)).toEqual(['src/Login.tsx'])
    expect(turnWritesFromLog([
      { seq: 1, turn: 1, role: 'user', text: 'look around' },
      { seq: 2, turn: 1, role: 'assistant', text: 'nothing to write', closed: true },
    ])).toEqual([])
  })

  it('projects 本轮变更 from DSH conversation nodes, including write tool args', () => {
    const snapshot = {
      nodes: [
        { kind: 'user', turn: 1, text: 'fix login' },
        {
          kind: 'tool-result',
          turn: 1,
          call: { name: 'str_replace', argsRaw: JSON.stringify({ file_path: 'src/Login.tsx' }) },
          text: LOGIN_AFTER,
        },
        { kind: 'assistant', turn: 1, text: 'done' },
      ],
    }
    expect(turnWritesFromSession(snapshot).map((change) => change.path)).toEqual(['src/Login.tsx'])
    expect(turnWritesFromSession({
      chat: {
        legacy: {
          nodes: [
            { kind: 'user', turn: 2, text: 'now notes' },
            {
              kind: 'tool-call',
              turn: 2,
              call: { name: 'write', argsRaw: JSON.stringify({ path: 'notes.md' }) },
            },
            {
              kind: 'tool-result',
              turn: 2,
              call: { name: 'write', argsRaw: JSON.stringify({ path: 'notes.md' }) },
              text: NOTES_AFTER,
            },
          ],
        },
      },
    })).toEqual([{ path: 'notes.md', before: '', after: NOTES_AFTER }])
    expect(turnWritesFromSession({
      nodes: [
        { kind: 'user', turn: 1, text: 'look around' },
        { kind: 'tool-result', turn: 1, call: { name: 'read', argsRaw: JSON.stringify({ path: 'src/Login.tsx' }) } },
      ],
    })).toEqual([])
    expect(turnWritesFromSession({
      nodes: [{
        kind: 'tool-result',
        turn: 1,
        call: { name: 'run_code', argsRaw: '{"code":"write()"}' },
        subCalls: [{
          kind: 'tool-result',
          callId: 'w1',
          call: {
            name: 'write',
            argsRaw: JSON.stringify({ file_path: 'diff-display-test.md', content: '# hi\n' }),
          },
          content: [],
          resultView: null,
          subCalls: [],
        }],
      }],
    }).map((change) => change.path)).toEqual(['diff-display-test.md'])
  })

  it('projects 本轮变更 from the RPC 主会话 log and keeps leftovers on the working tree', () => {
    const registry = createRegistry({
      persist: memoryPersist(),
      filesFor: () => memoryFiles({ 'src/Login.tsx': LOGIN_AFTER, 'notes.md': NOTES_AFTER }),
      reviewFor: (_id, io) => ({
        turnWrites: () => io.turnWrites(),
        workingTree: () => [LOGIN_TURN, NOTES_TREE],
        isBusy: io.isBusy,
      }),
    })
    const opened = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: '/work',
      busy: false,
      turnWrites: [LOGIN_TURN],
      intent: { type: 'pick-tool', kind: 'Review' },
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const snap = opened.value as { snapshot: { review: { mode: string; files: Array<{ path: string }> } } }
    expect(snap.snapshot.review.mode).toBe('turn')
    expect(snap.snapshot.review.files.map((file) => file.path)).toEqual(['src/Login.tsx'])

    const tree = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: '/work',
      busy: false,
      turnWrites: [LOGIN_TURN],
      intent: { type: 'review-switch', mode: 'tree' },
    })
    expect(tree.ok).toBe(true)
    if (!tree.ok) return
    const next = tree.value as { snapshot: { review: { files: Array<{ path: string }> } } }
    expect(next.snapshot.review.files.map((file) => file.path)).toEqual(['src/Login.tsx', 'notes.md'])

    const emptyRegistry = createRegistry({
      persist: memoryPersist(),
      filesFor: () => memoryFiles({ 'notes.md': NOTES_AFTER }),
      reviewFor: (_id, io) => ({
        turnWrites: () => io.turnWrites(),
        workingTree: () => [NOTES_TREE],
        isBusy: io.isBusy,
      }),
    })
    const emptyTurn = handleSidebarRpc(emptyRegistry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-b',
      cwd: '/work',
      busy: false,
      turnWrites: [],
      intent: { type: 'pick-tool', kind: 'Review' },
    })
    expect(emptyTurn.ok).toBe(true)
    if (!emptyTurn.ok) return
    const empty = emptyTurn.value as { snapshot: { review: { files: unknown[] } } }
    expect(empty.snapshot.review.files).toEqual([])
  })
})
