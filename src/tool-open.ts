/** How a 主会话 path click should open Files — plugin-side, not DSH core. */

import { isRecord } from './contract.ts'
import { fileDiff, type ReviewChange } from './review.ts'

export const WRITE_TOOL = /^(write|edit|str_replace|strreplace|search_replace|apply_patch|notebook)/i

export type OpenHunk = { before: string; after: string; op: 'write' | 'edit' }

let collecting: Array<OpenHunk & { path: string }> | undefined
const collectedCache = new WeakMap<object, { stats: Stats; hunks: Array<OpenHunk & { path: string }> }>()

export function viewForTool(toolName: string | undefined): 'preview' | 'diff' {
  if (toolName !== undefined && WRITE_TOOL.test(toolName)) return 'diff'
  return 'preview'
}

export function statForLabel(
  stats: Record<string, { added: number; removed: number }>,
  label: string,
): { added: number; removed: number } | undefined {
  const text = label.trim().replace(/\\/g, '/')
  if (text.length === 0) return undefined
  if (stats[text] !== undefined) return stats[text]
  const keys = Object.keys(stats)
  const rel = keys.filter((key) => text === key || text.endsWith('/' + key) || key.endsWith('/' + text))
  if (rel.length === 1) {
    const key = rel[0]
    return key === undefined ? undefined : stats[key]
  }
  const base = text.split('/').pop() ?? text
  const byBase = keys.filter((key) => (key.split('/').pop() ?? key) === base)
  if (byBase.length === 1) {
    const key = byBase[0]
    return key === undefined ? undefined : stats[key]
  }
  return undefined
}

export function statsFromSnapshot(snapshot: unknown): Record<string, { added: number; removed: number }> {
  return collectFromSnapshot(snapshot).stats
}

export type RowStat = { path: string; added: number; removed: number }
export type RowHunkStat = RowStat & { hunkId: string }

export function rowStatsFromSnapshot(snapshot: unknown): RowStat[] {
  return collectFromSnapshot(snapshot).hunks.map((hunk) => {
    const diff = fileDiff(hunk.before, hunk.after)
    return { path: hunk.path, added: diff.added, removed: diff.removed }
  })
}

/** Same row stats with a snapshot-local identity for exact path opening. */
export function rowHunksFromSnapshot(snapshot: unknown): RowHunkStat[] {
  return indexedHunks(snapshot).map((hunk) => {
    const diff = fileDiff(hunk.before, hunk.after)
    return { path: hunk.path, added: diff.added, removed: diff.removed, hunkId: hunk.hunkId }
  })
}

type QueuedRow = { added: number; removed: number; hunkId?: string }

export function queueRowStats(rows: readonly (RowStat & { hunkId?: string })[]): Map<string, QueuedRow[]> {
  const pending = new Map<string, QueuedRow[]>()
  for (const row of rows) {
    const list = pending.get(row.path) ?? []
    list.push({ added: row.added, removed: row.removed, ...(row.hunkId === undefined ? {} : { hunkId: row.hunkId }) })
    pending.set(row.path, list)
  }
  return pending
}

export function takeRowStat(
  pending: Map<string, QueuedRow[]>,
  label: string,
): { added: number; removed: number } | undefined {
  const next = takeRowHunk(pending, label)
  return next === undefined ? undefined : { added: next.added, removed: next.removed }
}

export function takeRowHunk(pending: Map<string, QueuedRow[]>, label: string): QueuedRow | undefined {
  const text = label.trim().replace(/\\/g, '/')
  if (text.length === 0) return undefined
  const keys = [...pending.keys()]
  const hit = keys.find((key) => key === text)
    ?? unique(keys.filter((key) => text.endsWith('/' + key) || key.endsWith('/' + text)))
    ?? unique(keys.filter((key) => (key.split('/').pop() ?? key) === (text.split('/').pop() ?? text)))
  if (hit === undefined) return undefined
  const queue = pending.get(hit)
  if (queue === undefined || queue.length === 0) return undefined
  const next = queue.shift()
  if (queue.length === 0) pending.delete(hit)
  return next
}

function unique(keys: string[]): string | undefined {
  return keys.length === 1 ? keys[0] : undefined
}

export function reviewChangesFromSnapshot(snapshot: unknown): ReviewChange[] {
  const byPath = new Map<string, ReviewChange>()
  for (const hunk of collectFromSnapshot(snapshot).hunks) {
    const prev = byPath.get(hunk.path)
    byPath.set(hunk.path, {
      path: hunk.path,
      before: prev === undefined ? hunk.before : prev.before,
      after: hunk.after,
    })
  }
  return [...byPath.values()]
}

export function hunkForOpen(snapshot: unknown, path: string, tool?: string, hunkId?: string): { before: string; after: string } | undefined {
  const hunks = indexedHunks(snapshot).filter((hunk) => statForLabel({ [hunk.path]: { added: 1, removed: 0 } }, path) !== undefined)
  if (hunks.length === 0) return undefined
  if (hunkId !== undefined) {
    const exact = hunks.find((hunk) => hunk.hunkId === hunkId)
    if (exact !== undefined) return { before: exact.before, after: exact.after }
  }
  const want = tool !== undefined && /^write$/i.test(tool) ? 'write' : tool !== undefined && WRITE_TOOL.test(tool) ? 'edit' : undefined
  const picked = want === undefined ? hunks : hunks.filter((hunk) => hunk.op === want)
  const use = picked.length > 0 ? picked : hunks
  const last = use[use.length - 1]
  return last === undefined ? undefined : { before: last.before, after: last.after }
}

function indexedHunks(snapshot: unknown): Array<OpenHunk & { path: string; hunkId: string }> {
  return collectFromSnapshot(snapshot).hunks.map((hunk, index) => ({ ...hunk, hunkId: String(index) }))
}

function collectFromSnapshot(snapshot: unknown): { stats: Stats; hunks: Array<OpenHunk & { path: string }> } {
  const stats: Stats = {}
  const hunks: Array<OpenHunk & { path: string }> = []
  if (!isRecord(snapshot)) return { stats, hunks }
  const cached = collectedCache.get(snapshot)
  if (cached !== undefined) return cached
  collecting = hunks
  try {
    const seen = new Set<object>()
    absorbRoots(snapshot.nodes, 'settled', stats, seen)
    absorbRoots(snapshot.runningCalls, 'running', stats, seen)
    absorbTree(snapshot.nodes, stats, seen)
    absorbTree(snapshot.runningCalls, stats, seen)
    if (isRecord(snapshot.chat)) {
      absorbTree(snapshot.chat.nodes, stats, seen)
      if (isRecord(snapshot.chat.legacy)) absorbTree(snapshot.chat.legacy.nodes, stats, seen)
    }
  } finally {
    collecting = undefined
  }
  const collected = { stats, hunks }
  collectedCache.set(snapshot, collected)
  return collected
}

type CallState = 'settled' | 'running'
type Stats = Record<string, { added: number; removed: number }>
type DiffHunk = { path: string; oldText: string | null; newText: string }

function absorbRoots(value: unknown, state: CallState, out: Stats, seen: Set<object>): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!isRecord(item) || typeof item.callId !== 'string') continue
    if (state === 'settled' ? item.kind !== 'tool-result' : item.kind !== undefined) continue
    absorbCall(item, state, out, seen)
  }
}

function absorbCall(call: Record<string, unknown>, state: CallState, out: Stats, seen: Set<object>): void {
  if (seen.has(call)) return
  seen.add(call)
  const start = collecting?.length ?? 0
  if (state === 'settled') {
    if (!absorbView(call.resultView, out)) absorbView(call.callView, out)
  } else {
    absorbView(call.callView, out)
  }
  absorbArgs(call, out)
  absorbPair(call, out)
  absorbResultText(call, out)
  collapseCallHunks(start)
  if (!Array.isArray(call.subCalls)) return
  for (const child of call.subCalls) {
    if (!isRecord(child) || typeof child.callId !== 'string') continue
    if (child.kind === 'tool-result') absorbCall(child, 'settled', out, seen)
    else if (child.kind === undefined) absorbCall(child, 'running', out, seen)
  }
}

function collapseCallHunks(start: number): void {
  if (collecting === undefined || collecting.length <= start) return
  const slice = collecting.slice(start)
  const seen = new Set<string>()
  const kept: Array<OpenHunk & { path: string }> = []
  for (const hunk of slice) {
    if (seen.has(hunk.path)) continue
    seen.add(hunk.path)
    kept.push(hunk)
  }
  collecting.splice(start, slice.length, ...kept)
}

function absorbView(value: unknown, out: Stats): boolean {
  const hunks = diffHunks(value)
  if (hunks === undefined) return false
  for (const hunk of hunks) {
    const before = hunk.oldText ?? ''
    noteHunk(hunk.path, before, hunk.newText, before.length === 0 ? 'write' : 'edit')
    mergeStat(out, hunk.path, fileDiff(before, hunk.newText))
  }
  return true
}

function absorbTree(value: unknown, out: Stats, seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return
  if (value instanceof Map) {
    for (const item of value.values()) absorbTree(item, out, seen)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) absorbTree(item, out, seen)
    return
  }
  if (!isRecord(value)) return
  const first = !seen.has(value)
  if (first) {
    seen.add(value)
    if (isToolish(value)) {
      absorbView(value, out)
      absorbArgs(value, out)
      absorbPair(value, out)
      absorbResultText(value, out)
    }
  }
  absorbTree(value.subCalls, out, seen)
  absorbTree(value.children, out, seen)
  absorbTree(value.nodes, out, seen)
  absorbTree(value.content, out, seen)
  if (first) absorbTree(value.arguments, out, seen)
}

function isToolish(rec: Record<string, unknown>): boolean {
  if (rec.kind === 'tool-result' || rec.kind === 'tool-call') return true
  if (typeof rec.name === 'string' && WRITE_TOOL.test(rec.name)) return true
  if (str(rec.file_path) !== undefined && (rec.old_string !== undefined || rec.new_string !== undefined || rec.content !== undefined)) {
    return true
  }
  return false
}

function absorbPair(rec: Record<string, unknown>, out: Stats): boolean {
  const path = str(rec.path) ?? str(rec.file_path)
  if (path === undefined) return false
  const after = rec.after ?? rec.newText ?? rec.new_string ?? rec.content
  if (typeof after !== 'string') return false
  const before = rec.before ?? rec.oldText ?? rec.old_string
  if (before !== null && before !== undefined && typeof before !== 'string') return false
  if (before === undefined && rec.content === undefined && rec.new_string === undefined && rec.after === undefined) {
    return false
  }
  const beforeText = typeof before === 'string' ? before : ''
  const op = rec.old_string !== undefined || rec.new_string !== undefined
    ? 'edit'
    : rec.content !== undefined || beforeText.length === 0 ? 'write' : 'edit'
  noteHunk(path, beforeText, after, op)
  mergeStat(out, path, fileDiff(beforeText, after))
  return true
}

function noteHunk(path: string, before: string, after: string, op: 'write' | 'edit'): void {
  collecting?.push({ path, before, after, op })
}

function absorbArgs(rec: Record<string, unknown>, out: Stats): void {
  const nested = isRecord(rec.call) ? rec.call : undefined
  const raw = str(rec.argsRaw) ?? (nested === undefined ? undefined : str(nested.argsRaw))
  if (raw !== undefined) absorbJson(raw, out)
  if (isRecord(rec.arguments)) absorbPair(rec.arguments, out)
  if (nested !== undefined && isRecord(nested.arguments)) absorbPair(nested.arguments, out)
}

function absorbResultText(rec: Record<string, unknown>, out: Stats): boolean {
  let hit = false
  if (typeof rec.text === 'string') hit = absorbJson(rec.text, out) || hit
  if (!Array.isArray(rec.content)) return hit
  for (const block of rec.content) {
    if (!isRecord(block) || typeof block.text !== 'string') continue
    hit = absorbJson(block.text, out) || hit
  }
  return hit
}

function absorbJson(raw: string, out: Stats): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed[0] !== '{') return false
  if (trimmed.indexOf('file_path') < 0 && trimmed.indexOf('"path"') < 0) return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) && absorbPair(parsed, out)
  } catch {
    return false
  }
}

function mergeStat(out: Stats, path: string, diff: { added: number; removed: number }): void {
  const prev = out[path]
  out[path] = prev === undefined
    ? { added: diff.added, removed: diff.removed }
    : { added: prev.added + diff.added, removed: prev.removed + diff.removed }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function diffHunks(value: unknown): DiffHunk[] | undefined {
  if (!isRecord(value) || value.card !== 'diff' || !Array.isArray(value.diffs) || value.diffs.length === 0) {
    return undefined
  }
  const out: DiffHunk[] = []
  for (const hunk of value.diffs) {
    if (!isRecord(hunk)) return undefined
    const { path, oldText, newText } = hunk
    if (typeof path !== 'string' || path.length === 0) return undefined
    if (oldText !== null && typeof oldText !== 'string') return undefined
    if (typeof newText !== 'string') return undefined
    out.push({ path, oldText, newText })
  }
  return out
}
