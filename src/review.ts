/** Review 工具: read-only 本轮变更 / working tree. Ticket 02 owns this file. */

import type { Annotation, Effect } from './session.ts'

export type ReviewIntent =
  | { type: 'review-switch'; mode: ReviewMode }
  | { type: 'review-set-branch'; branch: string }
  | { type: 'review-toggle-file'; path: string }
  | { type: 'review-gutter'; mark: string }
  | { type: 'review-set-note-draft'; text: string }
  | { type: 'review-note-add' }
  | { type: 'review-note-send' }
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
  editingId: string | null
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
    editingId: null,
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
    const diff = lineStats(change.before, change.after)
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
          editingId: null,
        },
        effects: [],
      }
    }
    case 'review-set-branch': {
      const branch = (intent as ReviewIntent & { type: 'review-set-branch' }).branch
      return {
        state: { ...current, branch, openPath: null, pendingMark: null, noteDraft: '', editingId: null },
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
          editingId: openPath === null ? null : current.editingId,
        },
        effects: [],
      }
    }
    case 'review-gutter': {
      const mark = (intent as ReviewIntent & { type: 'review-gutter' }).mark
      return {
        state: { ...current, pendingMark: mark, noteDraft: '', editingId: null },
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
        state: { ...current, pendingMark: null, noteDraft: '', editingId: null },
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
    editingId: state.editingId ?? null,
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

const MAX_DIFF_LINES = 4_000
const MAX_DIFF_CELLS = 250_000
const CONTEXT = 3

function sharedEnds(oldLines: readonly string[], newLines: readonly string[]): { prefix: number; suffix: number } {
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) suffix += 1
  return { prefix, suffix }
}

function tooLarge(oldCount: number, newCount: number): boolean {
  return oldCount > MAX_DIFF_LINES
    || newCount > MAX_DIFF_LINES
    || (oldCount + 1) * (newCount + 1) > MAX_DIFF_CELLS
}

function countMarks(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added += 1
    if (line.kind === 'del') removed += 1
  }
  return { added, removed }
}

function shiftLineNos(lines: readonly DiffLine[], offset: number): DiffLine[] {
  return lines.map((line) => ({
    ...line,
    oldNo: line.oldNo === null ? null : line.oldNo + offset,
    newNo: line.newNo === null ? null : line.newNo + offset,
  }))
}

/** Keep ctx only near an add/del so two distant edits do not paint the whole file. */
function compactHunk(lines: readonly DiffLine[], context: number): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.kind === 'ctx') continue
    const from = Math.max(0, i - context)
    const to = Math.min(lines.length - 1, i + context)
    for (let j = from; j <= to; j += 1) keep[j] = true
  }
  const out: DiffLine[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (keep[i] === true && line !== undefined) out.push(line)
  }
  return out
}

/** +/− for badges. Strip shared ends, then LCS only the unique middle. */
export function lineStats(before: string, after: string): { added: number; removed: number } {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  const { prefix, suffix } = sharedEnds(oldLines, newLines)
  const oldMid = oldLines.slice(prefix, oldLines.length - suffix)
  const newMid = newLines.slice(prefix, newLines.length - suffix)
  if (oldMid.length === 0 && newMid.length === 0) return { added: 0, removed: 0 }
  if (tooLarge(oldMid.length, newMid.length)) return { added: newMid.length, removed: oldMid.length }
  return countMarks(lineDiff(oldMid, newMid))
}

export function fileDiff(before: string, after: string): FileDiff {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  const { prefix, suffix } = sharedEnds(oldLines, newLines)
  const oldMid = oldLines.slice(prefix, oldLines.length - suffix)
  const newMid = newLines.slice(prefix, newLines.length - suffix)
  if (tooLarge(oldMid.length, newMid.length)) {
    const stats = { added: newMid.length, removed: oldMid.length }
    return { ...stats, hunk: '@@ diff truncated: file too large @@', lines: [] }
  }
  const mid = shiftLineNos(lineDiff(oldMid, newMid), prefix)
  const stats = countMarks(mid)
  const preFrom = Math.max(0, prefix - CONTEXT)
  const lines: DiffLine[] = []
  for (let i = preFrom; i < prefix; i += 1) {
    lines.push({ kind: 'ctx', text: oldLines[i] ?? '', oldNo: i + 1, newNo: i + 1 })
  }
  lines.push(...compactHunk(mid, CONTEXT))
  const sufCount = Math.min(CONTEXT, suffix)
  const sufOld = oldLines.length - suffix
  const sufNew = newLines.length - suffix
  for (let i = 0; i < sufCount; i += 1) {
    lines.push({ kind: 'ctx', text: oldLines[sufOld + i] ?? '', oldNo: sufOld + i + 1, newNo: sufNew + i + 1 })
  }
  return { ...stats, hunk: hunkHeader(lines), lines }
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
