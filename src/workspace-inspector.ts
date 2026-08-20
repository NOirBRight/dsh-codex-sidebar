/** Async, bounded workspace projection for visible Files/Review tools. */

import { execFile } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileChange, SidebarSnapshot, TreeNode } from './session.ts'
import { fileDiff, type DiffLine, type FileDiff, type ReviewChange, type ReviewFile, type ReviewMode, type ReviewScopeStats, type ReviewState } from './review.ts'

const CACHE_TTL_MS = 1_500
const GIT_TIMEOUT_MS = 3_000
const MAX_GIT_BUFFER = 4 * 1024 * 1024
const MAX_TREE_NODES = 400
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_DIFF_CELLS = 250_000
const MAX_DIFF_LINES = 4_000
const MAX_CACHE_ENTRIES = 100
const SKIP_WALK = new Set(['node_modules', '.git', 'dist', 'lib', 'coverage', '.next', '.cache'])
const SKIP_SHOW = new Set(['.git'])
const SHOW_COLLAPSED = new Set(['node_modules'])

export type WorkspaceGate = {
  cwd: string
  turnWrites?: ReviewChange[]
}

export type AsyncGitExec = (args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<string>

export type WorkspaceInspector = {
  project(snapshot: SidebarSnapshot, gate: WorkspaceGate, signal?: AbortSignal): Promise<SidebarSnapshot>
  execCount(): number
  clear(): void
}

type Stat = { added: number; removed: number; binary?: boolean }
type GitSnapshot = {
  inside: boolean
  branch: string
  branches: string[]
  untracked: Set<string>
  uncommitted: Record<string, Stat>
  staged: Record<string, Stat>
  unstaged: Record<string, Stat>
}
type Timed<T> = { at: number; value: T }

export function createWorkspaceInspector(opts: { gitExec?: AsyncGitExec; ttlMs?: number; now?: () => number } = {}): WorkspaceInspector {
  const exec = opts.gitExec ?? defaultGitExec
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS
  const now = opts.now ?? Date.now
  const gitCache = new Map<string, Timed<GitSnapshot>>()
  const gitPending = new Map<string, Promise<GitSnapshot>>()
  const refCache = new Map<string, Timed<Record<string, Stat>>>()
  const refPending = new Map<string, Promise<Record<string, Stat>>>()
  const detailCache = new Map<string, Timed<FileDiff | null>>()
  const detailPending = new Map<string, Promise<FileDiff | null>>()
  const treeCache = new Map<string, Timed<TreeNode[]>>()
  const treePending = new Map<string, Promise<TreeNode[]>>()
  let execs = 0

  async function run(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
    execs += 1
    return exec(args, cwd, signal)
  }

  async function git(cwd: string, signal?: AbortSignal): Promise<GitSnapshot> {
    if (cwd.length === 0) return emptyGit()
    const hit = gitCache.get(cwd)
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.value
    const pending = gitPending.get(cwd)
    if (pending !== undefined) return pending
    const created = loadGit(cwd, run, signal).then((value) => {
      putBounded(gitCache, cwd, { at: now(), value })
      return value
    }).finally(() => { gitPending.delete(cwd) })
    gitPending.set(cwd, created)
    return created
  }

  async function against(cwd: string, ref: string, signal?: AbortSignal): Promise<Record<string, Stat>> {
    const key = cwd + '\0' + ref
    const hit = refCache.get(key)
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.value
    const pending = refPending.get(key)
    if (pending !== undefined) return pending
    const created = safeRun(run, ['diff', '--numstat', ref], cwd, signal).then(parseNumstat).then((value) => {
      putBounded(refCache, key, { at: now(), value })
      return value
    }).finally(() => { refPending.delete(key) })
    refPending.set(key, created)
    return created
  }

  async function detail(cwd: string, mode: ReviewMode, branch: string, current: string, path: string, untracked: ReadonlySet<string>, signal?: AbortSignal): Promise<FileDiff | null> {
    const key = [cwd, mode, branch, current, path].join('\0')
    const hit = detailCache.get(key)
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.value
    const pending = detailPending.get(key)
    if (pending !== undefined) return pending
    const created = loadDetail(cwd, mode, branch, current, path, untracked, run, signal).then((value) => {
      putBounded(detailCache, key, { at: now(), value })
      return value
    }).finally(() => { detailPending.delete(key) })
    detailPending.set(key, created)
    return created
  }

  async function tree(cwd: string, signal?: AbortSignal): Promise<TreeNode[]> {
    if (cwd.length === 0) return []
    const hit = treeCache.get(cwd)
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.value
    const pending = treePending.get(cwd)
    if (pending !== undefined) return pending
    const created = walkWorkspace(cwd, signal).then((value) => {
      putBounded(treeCache, cwd, { at: now(), value })
      return value
    }).finally(() => { treePending.delete(cwd) })
    treePending.set(cwd, created)
    return created
  }

  return {
    execCount: () => execs,
    clear() {
      gitCache.clear(); gitPending.clear(); refCache.clear(); refPending.clear()
      detailCache.clear(); detailPending.clear(); treeCache.clear(); treePending.clear(); execs = 0
    },
    async project(snapshot, gate, signal) {
      if (snapshot.collapsed) return snapshot
      const active = snapshot.tabs.find((tab) => tab.id === snapshot.active)
      if (active?.kind === 'Review') {
        const repo = await git(gate.cwd, signal)
        const review = await projectReviewAsync(snapshot.review, gate.turnWrites ?? [], repo, gate.cwd, against, detail, signal)
        return { ...snapshot, review }
      }
      if (active?.kind === 'Files') {
        const nodes = await tree(gate.cwd, signal)
        const path = snapshot.files.path || nodes.find((node) => node.kind !== 'dir')?.path || ''
        const preview = await readPreview(gate.cwd, path, signal)
        const hunk = snapshot.files.hunk ?? (path.length === 0 ? undefined : await readChange(gate.cwd, path, preview, run, signal))
        const diff = hunk === undefined || hunk.before === hunk.after ? null : boundedFileDiff(hunk.before, hunk.after)
        const tabs = path.length === 0 || path === snapshot.files.path
          ? snapshot.tabs
          : snapshot.tabs.map((tab) => tab.id === snapshot.active && tab.kind === 'Files'
            ? { ...tab, target: path, title: path.split('/').pop() || 'Files' }
            : tab)
        return {
          ...snapshot,
          tabs,
          files: {
            ...snapshot.files,
            path,
            tree: nodes,
            preview,
            hunk: hunk ?? null,
            diff,
            view: diff === null ? 'preview' : snapshot.files.view,
          },
          fileStats: {},
        }
      }
      return snapshot
    },
  }
}

async function loadGit(cwd: string, run: AsyncGitExec, signal?: AbortSignal): Promise<GitSnapshot> {
  const [statusText, branchesText, uncommittedText, stagedText, unstagedText] = await Promise.all([
    safeRun(run, ['status', '--porcelain=v2', '--branch', '-z'], cwd, signal),
    safeRun(run, ['branch', '--format=%(refname:short)\t%(HEAD)'], cwd, signal),
    safeRun(run, ['diff', '--numstat', 'HEAD'], cwd, signal),
    safeRun(run, ['diff', '--cached', '--numstat'], cwd, signal),
    safeRun(run, ['diff', '--numstat'], cwd, signal),
  ])
  if (statusText.length === 0 && branchesText.length === 0) return emptyGit()
  const status = parseStatus(statusText)
  const uncommitted = parseNumstat(uncommittedText)
  const unstaged = parseNumstat(unstagedText)
  const fresh = await untrackedStats(cwd, status.untracked, signal)
  for (const path of status.untracked) {
    uncommitted[path] ??= fresh[path] ?? { added: 0, removed: 0 }
    unstaged[path] ??= fresh[path] ?? { added: 0, removed: 0 }
  }
  const branches = parseBranches(branchesText, status.branch)
  return {
    inside: true,
    branch: branches.current,
    branches: branches.names,
    untracked: status.untracked,
    uncommitted,
    staged: parseNumstat(stagedText),
    unstaged,
  }
}

async function untrackedStats(cwd: string, paths: ReadonlySet<string>, signal?: AbortSignal): Promise<Record<string, Stat>> {
  const out: Record<string, Stat> = {}
  const list = [...paths]
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < list.length) {
      const path = list[cursor]
      cursor += 1
      if (path === undefined) continue
      const text = await readPreview(cwd, path, signal)
      if (text === undefined || text.startsWith('data:') || text.startsWith('[File too large')) {
        out[path] = { added: 0, removed: 0, binary: true }
      } else {
        out[path] = { added: lineCount(text), removed: 0 }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, () => worker()))
  return out
}

async function projectReviewAsync(
  state: ReviewState,
  turnWrites: ReviewChange[],
  repo: GitSnapshot,
  cwd: string,
  against: (cwd: string, ref: string, signal?: AbortSignal) => Promise<Record<string, Stat>>,
  detail: (cwd: string, mode: ReviewMode, branch: string, current: string, path: string, untracked: ReadonlySet<string>, signal?: AbortSignal) => Promise<FileDiff | null>,
  signal?: AbortSignal,
): Promise<ReviewState> {
  const mode = normalizeMode(state.mode)
  const branch = state.branch.length > 0 && repo.branches.includes(state.branch) ? state.branch : repo.branch
  const vsOther = branch.length > 0 && branch !== repo.branch
  const other = vsOther ? await against(cwd, branch, signal) : undefined
  const turnFiles = turnWrites.map(toReviewSummary)
  const bags = {
    turn: turnFiles,
    uncommitted: summaries(other ?? repo.uncommitted),
    staged: vsOther ? [] : summaries(repo.staged),
    unstaged: summaries(other ?? repo.unstaged),
  }
  const files = filesForMode(mode, bags)
  let openDiff: ReviewFile | null = null
  if (state.openPath !== null) {
    const summary = files.find((file) => file.path === state.openPath)
    if (summary !== undefined) {
      if (mode === 'turn') {
        const change = turnWrites.find((item) => item.path === state.openPath)
        if (change !== undefined) openDiff = { ...summary, ...boundedFileDiff(change.before, change.after) }
      } else {
        const loaded = await detail(cwd, mode, branch, repo.branch, state.openPath, repo.untracked, signal)
        if (loaded !== null) openDiff = { ...summary, ...loaded }
      }
    }
  }
  return {
    ...state,
    mode,
    branch,
    branches: { current: repo.branch, names: repo.branches },
    files,
    openDiff,
    scopes: {
      turn: tallyFiles(turnFiles),
      uncommitted: tallyStats(other ?? repo.uncommitted),
      staged: vsOther ? { added: 0, removed: 0 } : tallyStats(repo.staged),
      unstaged: tallyStats(other ?? repo.unstaged),
    },
  }
}

function filesForMode(mode: ReviewMode, bags: { turn: ReviewFile[]; uncommitted: ReviewFile[]; staged: ReviewFile[]; unstaged: ReviewFile[] }): ReviewFile[] {
  if (mode === 'uncommitted') return bags.uncommitted
  if (mode === 'staged') return bags.staged
  if (mode === 'unstaged') return bags.unstaged
  return bags.turn
}

function normalizeMode(mode: ReviewMode): ReviewMode {
  return mode === 'tree' ? 'uncommitted' : mode
}

function toReviewSummary(change: ReviewChange): ReviewFile {
  const slash = change.path.lastIndexOf('/')
  const stats = fastLineStats(change.before, change.after)
  return {
    path: change.path,
    name: slash === -1 ? change.path : change.path.slice(slash + 1),
    dir: slash === -1 ? '' : change.path.slice(0, slash),
    added: stats.added,
    removed: stats.removed,
    hunk: '',
    lines: [],
  }
}

function summaries(stats: Record<string, Stat>): ReviewFile[] {
  return Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => {
    const slash = path.lastIndexOf('/')
    return {
      path,
      name: slash === -1 ? path : path.slice(slash + 1),
      dir: slash === -1 ? '' : path.slice(0, slash),
      added: value.added,
      removed: value.removed,
      hunk: '',
      lines: [],
    }
  })
}

function tallyFiles(files: readonly ReviewFile[]): ReviewScopeStats {
  return files.reduce((out, file) => ({ added: out.added + file.added, removed: out.removed + file.removed }), { added: 0, removed: 0 })
}

function tallyStats(stats: Record<string, Stat>): ReviewScopeStats {
  return Object.values(stats).reduce((out, value) => ({ added: out.added + value.added, removed: out.removed + value.removed }), { added: 0, removed: 0 })
}

async function loadDetail(cwd: string, mode: ReviewMode, branch: string, current: string, path: string, untracked: ReadonlySet<string>, run: AsyncGitExec, signal?: AbortSignal): Promise<FileDiff | null> {
  if (untracked.has(path) && mode !== 'staged') {
    const text = await readPreview(cwd, path, signal)
    if (text === undefined || text.startsWith('data:')) return null
    return boundedFileDiff('', text)
  }
  const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3']
  if (mode === 'staged') args.push('--cached')
  if (branch.length > 0 && branch !== current) args.push(branch)
  else if (mode === 'uncommitted') args.push('HEAD')
  args.push('--', path)
  const patch = await safeRun(run, args, cwd, signal)
  return parsePatch(patch)
}

export function parsePatch(patch: string): FileDiff | null {
  const lines: DiffLine[] = []
  let hunk = ''
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (match !== null) {
      if (hunk.length === 0) hunk = raw
      oldNo = Number(match[1])
      newNo = Number(match[2])
      continue
    }
    if (hunk.length === 0 || raw.startsWith('\ No newline')) continue
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lines.push({ kind: 'add', text: raw.slice(1), oldNo: null, newNo })
      newNo += 1
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      lines.push({ kind: 'del', text: raw.slice(1), oldNo, newNo: null })
      oldNo += 1
    } else if (raw.startsWith(' ')) {
      lines.push({ kind: 'ctx', text: raw.slice(1), oldNo, newNo })
      oldNo += 1; newNo += 1
    }
  }
  if (hunk.length === 0) return null
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
    hunk,
    lines,
  }
}

function boundedFileDiff(before: string, after: string): FileDiff {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  if (
    oldLines.length <= MAX_DIFF_LINES
    && newLines.length <= MAX_DIFF_LINES
    && (oldLines.length + 1) * (newLines.length + 1) <= MAX_DIFF_CELLS
  ) return fileDiff(before, after)
  const lines: DiffLine[] = []
  const limit = 2_000
  for (let index = 0; index < Math.min(oldLines.length, limit); index += 1) lines.push({ kind: 'del', text: oldLines[index] ?? '', oldNo: index + 1, newNo: null })
  for (let index = 0; index < Math.min(newLines.length, limit); index += 1) lines.push({ kind: 'add', text: newLines[index] ?? '', oldNo: null, newNo: index + 1 })
  return { added: newLines.length, removed: oldLines.length, hunk: '@@ diff truncated: file too large @@', lines }
}

async function readChange(cwd: string, path: string, after: string | undefined, run: AsyncGitExec, signal?: AbortSignal): Promise<FileChange | undefined> {
  if (path.length === 0 || after?.startsWith('data:') || after?.startsWith('[File too large')) return undefined
  const before = await safeRun(run, ['show', 'HEAD:' + path], cwd, signal)
  const next = after ?? ''
  if (before === next || (before.length === 0 && next.length === 0)) return undefined
  return { before, after: next }
}

async function readPreview(cwd: string, path: string, signal?: AbortSignal): Promise<string | undefined> {
  if (path.length === 0 || (cwd.length === 0 && !isAbsolute(path))) return undefined
  const full = safePath(cwd, path)
  if (full === undefined) return undefined
  try {
    signal?.throwIfAborted()
    const info = await stat(full)
    if (!info.isFile()) return undefined
    if (info.size > MAX_PREVIEW_BYTES) return '[File too large to preview: ' + info.size + ' bytes]'
    const handle = await open(full, 'r')
    try {
      const buffer = Buffer.alloc(Number(info.size))
      await handle.read(buffer, 0, buffer.length, 0)
      signal?.throwIfAborted()
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'data:' + imageMime(path) + ';base64,' + buffer.toString('base64')
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

async function walkWorkspace(cwd: string, signal?: AbortSignal): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  async function walk(dir: string): Promise<void> {
    if (nodes.length >= MAX_TREE_NODES) return
    signal?.throwIfAborted()
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (nodes.length >= MAX_TREE_NODES) return
      if (SKIP_SHOW.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = relative(cwd, full).split(sep).join('/')
      if (entry.isDirectory()) {
        if (SKIP_WALK.has(entry.name)) {
          if (SHOW_COLLAPSED.has(entry.name)) nodes.push({ path: rel, name: entry.name, kind: 'dir' })
          continue
        }
        const before = nodes.length
        await walk(full)
        if (nodes.length === before) nodes.push({ path: rel, name: entry.name, kind: 'dir' })
      } else if (entry.isFile()) nodes.push({ path: rel, name: entry.name })
    }
  }
  await walk(cwd)
  return nodes
}

function safePath(cwd: string, path: string): string | undefined {
  const root = resolve(cwd)
  const full = resolve(isAbsolute(path) ? path : join(root, path))
  // Absolute paths are already an established FilesPort capability; relative
  // paths remain confined to the 主会话 workspace.
  return isAbsolute(path) || full === root || full.startsWith(root + sep) ? full : undefined
}

function parseStatus(raw: string): { branch: string; untracked: Set<string> } {
  let branch = ''
  const untracked = new Set<string>()
  for (const rec of raw.split('\0')) {
    if (rec.startsWith('# branch.head ')) {
      const name = rec.slice('# branch.head '.length).trim()
      if (name !== '(detached)') branch = name
    } else if (rec.startsWith('? ')) untracked.add(rec.slice(2))
  }
  return { branch, untracked }
}

function parseBranches(raw: string, fallback: string): { current: string; names: string[] } {
  let current = fallback
  const names: string[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const [name = '', head = ''] = line.split('\t')
    if (name.length === 0) continue
    names.push(name)
    if (head === '*') current = name
  }
  return { current, names }
}

export function parseNumstat(raw: string): Record<string, Stat> {
  const out: Record<string, Stat> = {}
  for (const line of raw.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (match === null) continue
    const path = numstatPath(match[3] ?? '')
    if (path.length === 0) continue
    out[path] = {
      added: match[1] === '-' ? 0 : Number(match[1]),
      removed: match[2] === '-' ? 0 : Number(match[2]),
      ...(match[1] === '-' || match[2] === '-' ? { binary: true } : {}),
    }
  }
  return out
}

function numstatPath(raw: string): string {
  const side = raw.includes(' => ') ? raw.slice(raw.lastIndexOf(' => ') + 4) : raw
  return side.replace(/^"(.*)"$/, '$1')
}

function emptyGit(): GitSnapshot {
  return { inside: false, branch: '', branches: [], untracked: new Set(), uncommitted: {}, staged: {}, unstaged: {} }
}

async function safeRun(run: AsyncGitExec, args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  try { return await run(args, cwd, signal) } catch { return '' }
}

function defaultGitExec(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('git', [...args], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_BUFFER,
      signal,
    }, (error, stdout) => {
      if (error !== null) rejectPromise(error)
      else resolvePromise(stdout)
    })
  })
}

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lineCount(text: string): number {
  return splitLines(text).length
}

function fastLineStats(before: string, after: string): { added: number; removed: number } {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) suffix += 1
  return {
    added: newLines.length - prefix - suffix,
    removed: oldLines.length - prefix - suffix,
  }
}

function imageMime(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function putBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size <= MAX_CACHE_ENTRIES) return
  const oldest = map.keys().next().value as K | undefined
  if (oldest !== undefined) map.delete(oldest)
}
