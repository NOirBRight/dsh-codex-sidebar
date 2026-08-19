/** Review 工具: read-only 本轮变更 / working tree. Ticket 02 owns this file. */

import type { Annotation, Effect } from './session.ts'

export type ReviewIntent =
  | { type: 'review-switch'; mode: ReviewMode }
  | { type: 'review-set-branch'; branch: string }
  | { type: 'review-toggle-file'; path: string }
  | { type: 'review-gutter'; mark: string }
  | { type: 'review-set-note-draft'; text: string }
  | { type: 'review-note-enter' }
  | { type: 'review-note-ctrl-enter' }
  | { type: 'review-dismiss-note' }

export type ReviewChange = {
  path: string
  before: string
  after: string
}

export type ReviewMode = 'turn' | 'uncommitted' | 'staged' | 'unstaged' | 'tree'

export type ReviewScopeStats = { added: number; removed: number }

export type ReviewPort = {
  turnWrites(): ReviewChange[]
  workingTree(): ReviewChange[]
  staged?(): ReviewChange[]
  unstaged?(): ReviewChange[]
  branches?(): { current: string; names: string[] }
  against?(ref: string): ReviewChange[]
  isBusy(): boolean
}

export type DiffLine = {
  kind: 'add' | 'del' | 'ctx'
  text: string
  oldNo: number | null
  newNo: number | null
}

export type ReviewFile = {
  path: string
  name: string
  dir: string
  added: number
  removed: number
  hunk: string
  lines: DiffLine[]
}

export type ReviewState = {
  mode: ReviewMode
  scopes: {
    turn: ReviewScopeStats
    uncommitted: ReviewScopeStats
    staged: ReviewScopeStats
    unstaged: ReviewScopeStats
  }
  branch: string
  branches: { current: string; names: string[] }
  openPath: string | null
  pendingMark: string | null
  noteDraft: string
  attachments: Annotation[]
  seq: number
  files: ReviewFile[]
  openDiff: ReviewFile | null
}

/** Keep composer fields, skip git-backed files/scopes until Review is open. */
export function rememberReview(state: ReviewState): ReviewState {
  const base = hydrate(state)
  return {
    ...base,
    files: [],
    openDiff: null,
    scopes: emptyScopes(),
    branches: { current: '', names: [] },
  }
}

export function emptyReview(): ReviewState {
  return {
    mode: 'turn',
    scopes: emptyScopes(),
    branch: '',
    branches: { current: '', names: [] },
    openPath: null,
    pendingMark: null,
    noteDraft: '',
    attachments: [],
    seq: 0,
    files: [],
    openDiff: null,
  }
}

export function projectReview(state: ReviewState, port?: ReviewPort): ReviewState {
  const base = hydrate(state)
  const branches = port?.branches?.() ?? { current: '', names: [] }
  const branch = base.branch.length > 0 && branches.names.includes(base.branch) ? base.branch : branches.current
  const vsOther = branch.length > 0 && branch !== branches.current
  const turn = port?.turnWrites() ?? []
  const uncommitted = vsOther && port?.against ? port.against(branch) : port?.workingTree() ?? []
  const staged = vsOther ? [] : port?.staged?.() ?? []
  const unstaged = vsOther ? uncommitted : port?.unstaged?.() ?? []
  const changes = changesForMode(base.mode, { turn, uncommitted, staged, unstaged })
  const files = changes.map(toFile)
  const openDiff = files.find((file) => file.path === base.openPath) ?? null
  return {
    ...base,
    files,
    openDiff,
    branch,
    branches,
    scopes: {
      turn: tally(turn),
      uncommitted: tally(uncommitted),
      staged: tally(staged),
      unstaged: tally(unstaged),
    },
  }
}

function changesForMode(
  mode: ReviewMode,
  bags: { turn: ReviewChange[]; uncommitted: ReviewChange[]; staged: ReviewChange[]; unstaged: ReviewChange[] },
): ReviewChange[] {
  if (mode === 'uncommitted' || mode === 'tree') return bags.uncommitted
  if (mode === 'staged') return bags.staged
  if (mode === 'unstaged') return bags.unstaged
  return bags.turn
}

function tally(changes: ReviewChange[]): ReviewScopeStats {
  let added = 0
  let removed = 0
  for (const change of changes) {
    const diff = fileDiff(change.before, change.after)
    added += diff.added
    removed += diff.removed
  }
  return { added, removed }
}

function emptyScopes(): ReviewState['scopes'] {
  const zero = { added: 0, removed: 0 }
  return { turn: zero, uncommitted: zero, staged: zero, unstaged: zero }
}

export function reduceReview(
  state: ReviewState,
  intent: { type: string },
  port?: ReviewPort,
): { state: ReviewState; effects: Effect[] } | undefined {
  void port
  const current = hydrate(state)
  switch (intent.type) {
    case 'review-switch': {
      const mode = (intent as ReviewIntent & { type: 'review-switch' }).mode
      if (mode !== 'turn' && mode !== 'tree' && mode !== 'uncommitted' && mode !== 'staged' && mode !== 'unstaged') {
        return { state: current, effects: [] }
      }
      return {
        state: {
          ...current,
          mode: normalizeMode(mode),
          openPath: null,
          pendingMark: null,
          noteDraft: '',
        },
        effects: [],
      }
    }
    case 'review-set-branch': {
      const branch = (intent as ReviewIntent & { type: 'review-set-branch' }).branch
      return {
        state: { ...current, branch, openPath: null, pendingMark: null, noteDraft: '' },
        effects: [],
      }
    }
    case 'review-toggle-file': {
      const path = (intent as ReviewIntent & { type: 'review-toggle-file' }).path
      const openPath = current.openPath === path ? null : path
      return {
        state: {
          ...current,
          openPath,
          pendingMark: openPath === null ? null : current.pendingMark,
          noteDraft: openPath === null ? '' : current.noteDraft,
        },
        effects: [],
      }
    }
    case 'review-gutter': {
      const mark = (intent as ReviewIntent & { type: 'review-gutter' }).mark
      return {
        state: { ...current, pendingMark: mark, noteDraft: '' },
        effects: [],
      }
    }
    case 'review-set-note-draft': {
      const text = (intent as ReviewIntent & { type: 'review-set-note-draft' }).text
      return {
        state: { ...current, noteDraft: text },
        effects: [],
      }
    }
    case 'review-dismiss-note':
      return {
        state: { ...current, pendingMark: null, noteDraft: '' },
        effects: [],
      }
    default:
      return undefined
  }
}

function normalizeMode(mode: ReviewMode | undefined): ReviewMode {
  if (mode === 'tree' || mode === 'uncommitted') return 'uncommitted'
  if (mode === 'staged' || mode === 'unstaged') return mode
  return 'turn'
}

function hydrate(state: ReviewState): ReviewState {
  return {
    mode: normalizeMode(state.mode),
    scopes: state.scopes ?? emptyScopes(),
    branch: state.branch ?? '',
    branches: state.branches ?? { current: '', names: [] },
    openPath: state.openPath ?? null,
    pendingMark: state.pendingMark ?? null,
    noteDraft: state.noteDraft ?? '',
    attachments: state.attachments ?? [],
    seq: state.seq ?? 0,
    files: state.files ?? [],
    openDiff: state.openDiff ?? null,
  }
}

export type FileDiff = {
  added: number
  removed: number
  hunk: string
  lines: DiffLine[]
}

export function fileDiff(before: string, after: string): FileDiff {
  const lines = lineDiff(splitLines(before), splitLines(after))
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added += 1
    if (line.kind === 'del') removed += 1
  }
  return { added, removed, hunk: hunkHeader(lines), lines }
}

function toFile(change: ReviewChange): ReviewFile {
  const slash = change.path.lastIndexOf('/')
  const name = slash === -1 ? change.path : change.path.slice(slash + 1)
  const dir = slash === -1 ? '' : change.path.slice(0, slash)
  return { path: change.path, name, dir, ...fileDiff(change.before, change.after) }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const parts = text.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function lineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const n = oldLines.length
  const m = newLines.length
  const dp: number[][] = []
  for (let i = 0; i <= n; i += 1) {
    const row: number[] = []
    for (let j = 0; j <= m; j += 1) row.push(0)
    dp.push(row)
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]
    const next = dp[i + 1]
    if (row === undefined || next === undefined) continue
    for (let j = m - 1; j >= 0; j -= 1) {
      if (oldLines[i] === newLines[j]) {
        row[j] = (next[j + 1] ?? 0) + 1
      } else {
        row[j] = Math.max(next[j] ?? 0, row[j + 1] ?? 0)
      }
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 1
  let newNo = 1
  while (i < n && j < m) {
    const a = oldLines[i]
    const b = newLines[j]
    if (a === undefined || b === undefined) break
    if (a === b) {
      lines.push({ kind: 'ctx', text: a, oldNo, newNo })
      i += 1
      j += 1
      oldNo += 1
      newNo += 1
      continue
    }
    const down = dp[i + 1]?.[j] ?? 0
    const right = dp[i]?.[j + 1] ?? 0
    if (down >= right) {
      lines.push({ kind: 'del', text: a, oldNo, newNo: null })
      i += 1
      oldNo += 1
    } else {
      lines.push({ kind: 'add', text: b, oldNo: null, newNo })
      j += 1
      newNo += 1
    }
  }
  while (i < n) {
    const a = oldLines[i]
    if (a === undefined) break
    lines.push({ kind: 'del', text: a, oldNo, newNo: null })
    i += 1
    oldNo += 1
  }
  while (j < m) {
    const b = newLines[j]
    if (b === undefined) break
    lines.push({ kind: 'add', text: b, oldNo: null, newNo })
    j += 1
    newNo += 1
  }
  return lines
}

function hunkHeader(lines: DiffLine[]): string {
  if (lines.length === 0) return '@@ -0,0 +0,0 @@'
  const oldCount = lines.filter((line) => line.kind !== 'add').length
  const newCount = lines.filter((line) => line.kind !== 'del').length
  const firstOld = lines.find((line) => line.oldNo !== null)?.oldNo
  const firstNew = lines.find((line) => line.newNo !== null)?.newNo
  const oldStart = oldCount === 0 ? 0 : firstOld ?? 0
  const newStart = newCount === 0 ? 0 : firstNew ?? 0
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
}
