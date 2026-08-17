/** Review 工具: read-only 本轮变更 / working tree. Ticket 02 owns this file. */

import type { Annotation, Effect } from './session.ts'

export type ReviewIntent =
  | { type: 'review-switch'; mode: 'turn' | 'tree' }
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

export type ReviewPort = {
  turnWrites(): ReviewChange[]
  workingTree(): ReviewChange[]
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
  mode: 'turn' | 'tree'
  openPath: string | null
  pendingMark: string | null
  noteDraft: string
  attachments: Annotation[]
  seq: number
  files: ReviewFile[]
  openDiff: ReviewFile | null
}

export function emptyReview(): ReviewState {
  return {
    mode: 'turn',
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
  const changes = base.mode === 'tree' ? port?.workingTree() ?? [] : port?.turnWrites() ?? []
  const files = changes.map(toFile)
  const openDiff = files.find((file) => file.path === base.openPath) ?? null
  return { ...base, files, openDiff }
}

export function reduceReview(
  state: ReviewState,
  intent: { type: string },
  port?: ReviewPort,
): { state: ReviewState; effects: Effect[] } | undefined {
  const current = hydrate(state)
  switch (intent.type) {
    case 'review-switch': {
      const mode = (intent as ReviewIntent & { type: 'review-switch' }).mode
      if (mode !== 'turn' && mode !== 'tree') return { state: current, effects: [] }
      return {
        state: {
          ...current,
          mode,
          openPath: null,
          pendingMark: null,
          noteDraft: '',
        },
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
    case 'review-note-enter': {
      if (current.pendingMark === null) return { state: current, effects: [] }
      const text = current.noteDraft || current.pendingMark
      const seq = current.seq + 1
      return {
        state: {
          ...current,
          seq,
          attachments: [...current.attachments, { id: `r${seq}`, text, from: current.pendingMark }],
          pendingMark: null,
          noteDraft: '',
        },
        effects: [],
      }
    }
    case 'review-note-ctrl-enter': {
      if (current.pendingMark === null) return { state: current, effects: [] }
      const text = current.noteDraft || current.pendingMark
      const seq = current.seq + 1
      const payload = [...current.attachments, { id: `r${seq}`, text, from: current.pendingMark }]
      const next = {
        ...current,
        seq,
        attachments: [],
        pendingMark: null,
        noteDraft: '',
      }
      if (port?.isBusy()) {
        return { state: next, effects: [{ type: 'queue', text, attachments: payload }] }
      }
      return { state: next, effects: [{ type: 'send', text, attachments: payload }] }
    }
    default:
      return undefined
  }
}

function hydrate(state: ReviewState): ReviewState {
  return {
    mode: state.mode === 'tree' ? 'tree' : 'turn',
    openPath: state.openPath ?? null,
    pendingMark: state.pendingMark ?? null,
    noteDraft: state.noteDraft ?? '',
    attachments: state.attachments ?? [],
    seq: state.seq ?? 0,
    files: state.files ?? [],
    openDiff: state.openDiff ?? null,
  }
}

function toFile(change: ReviewChange): ReviewFile {
  const slash = change.path.lastIndexOf('/')
  const name = slash === -1 ? change.path : change.path.slice(slash + 1)
  const dir = slash === -1 ? '' : change.path.slice(0, slash)
  const lines = lineDiff(splitLines(change.before), splitLines(change.after))
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added += 1
    if (line.kind === 'del') removed += 1
  }
  return {
    path: change.path,
    name,
    dir,
    added,
    removed,
    hunk: hunkHeader(lines),
    lines,
  }
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
