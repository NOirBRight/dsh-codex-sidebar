import { describe, expect, it } from 'vitest'
import { createSidebarSession, PALETTE } from '../src/session.ts'
import type { FilesPort, Intent, PersistPort } from '../src/session.ts'
import type { ReviewPort } from '../src/review.ts'

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
  busy?: () => boolean
}): ReviewPort {
  return {
    turnWrites() {
      return opts?.turn ?? []
    },
    workingTree() {
      return opts?.tree ?? []
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
    expect(snap.review.mode).toBe('tree')
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
    expect(box.snapshot().review.attachments).toEqual([
      { id: 'r1', text: 'restore the deleted OK button', from: 'src/Login.tsx:2' },
    ])
    expect(box.snapshot().review.pendingMark).toBeNull()

    box.dispatch({ type: 'review-gutter', mark: 'src/Login.tsx:2' })
    box.dispatch({ type: 'review-set-note-draft', text: 'keep the Sign in heading' })
    const sent = box.dispatch({ type: 'review-note-ctrl-enter' })
    expect(sent).toEqual([{
      type: 'send',
      text: 'keep the Sign in heading',
      attachments: [
        { id: 'r1', text: 'restore the deleted OK button', from: 'src/Login.tsx:2' },
        { id: 'r2', text: 'keep the Sign in heading', from: 'src/Login.tsx:2' },
      ],
    }])
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
      text: 'src/Login.tsx:2',
      attachments: [{ id: 'r1', text: 'src/Login.tsx:2', from: 'src/Login.tsx:2' }],
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
})
