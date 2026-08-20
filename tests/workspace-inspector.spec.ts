import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_SNAPSHOT_ENDPOINT } from '../src/contract.ts'
import { handleSidebarRpcAsync } from '../src/host-rpc.ts'
import { createFsFiles } from '../src/host-files.ts'
import { createRegistry } from '../src/registry.ts'
import { createSidebarSession } from '../src/session.ts'
import type { FilesPort, PersistPort, SidebarSnapshot, ToolKind } from '../src/session.ts'
import { createWorkspaceInspector, parsePatch, type AsyncGitExec } from '../src/workspace-inspector.ts'

function memoryPersist(saved?: SidebarSnapshot): PersistPort {
  let value = saved
  return {
    load() { return value },
    save(_id, snapshot) { value = snapshot },
  }
}

const files: FilesPort = { read() { return '' }, tree() { return [] } }

function snapshot(kind: ToolKind, opts: { collapsed?: boolean; mode?: 'turn' | 'uncommitted' } = {}): SidebarSnapshot {
  const box = createSidebarSession({ sessionId: 'sess-workspace', persist: memoryPersist(), files, isBusy: () => false })
  box.dispatch({ type: 'pick-tool', kind })
  if (opts.mode !== undefined) box.dispatch({ type: 'review-switch', mode: opts.mode })
  if (opts.collapsed === true) box.dispatch({ type: 'toggle-collapsed' })
  return box.snapshot(false)
}

function gitFixture(delay?: Promise<void>): { exec: AsyncGitExec; calls: string[][] } {
  const calls: string[][] = []
  const numstat = Array.from({ length: 330 }, (_, index) => `1\t1\tsrc/file-${index}.ts`).join('\n')
  const exec: AsyncGitExec = async (args) => {
    calls.push([...args])
    await delay
    if (args[0] === 'status') return '# branch.head main\0? fresh.ts\0'
    if (args[0] === 'branch') return 'main\t*\n'
    if (args[0] === 'show') throw new Error('per-file show is forbidden')
    if (args.includes('--unified=3')) {
      return 'diff --git a/src/file-1.ts b/src/file-1.ts\n--- a/src/file-1.ts\n+++ b/src/file-1.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n'
    }
    if (args[0] === 'diff' && args.includes('--numstat')) return numstat
    return ''
  }
  return { exec, calls }
}

describe('async workspace inspector', () => {
  it('does no workspace I/O while collapsed or behind another active tool', async () => {
    const fixture = gitFixture()
    const inspector = createWorkspaceInspector({ gitExec: fixture.exec })
    await inspector.project(snapshot('Review', { collapsed: true }), { cwd: '/work' })

    const box = createSidebarSession({ sessionId: 'sess-background', persist: memoryPersist(), files, isBusy: () => false })
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.dispatch({ type: 'open-empty-tab' })
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    await inspector.project(box.snapshot(false), { cwd: '/work' })
    expect(fixture.calls).toEqual([])
  })

  it('projects 330 dirty files with a fixed command count and selected-path detail', async () => {
    const fixture = gitFixture()
    const inspector = createWorkspaceInspector({ gitExec: fixture.exec })
    const summary = await inspector.project(snapshot('Review', { mode: 'uncommitted' }), { cwd: '/work' })
    expect(summary.review.files).toHaveLength(331)
    expect(fixture.calls).toHaveLength(5)
    expect(fixture.calls.some((args) => args[0] === 'show')).toBe(false)

    const opened = { ...summary, review: { ...summary.review, openPath: 'src/file-1.ts' } }
    const detailed = await inspector.project(opened, { cwd: '/work' })
    expect(detailed.review.openDiff?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'del', text: 'old' }),
      expect.objectContaining({ kind: 'add', text: 'new' }),
    ]))
    expect(fixture.calls).toHaveLength(6)
    expect(fixture.calls[5]).toEqual(expect.arrayContaining(['--', 'src/file-1.ts']))
  })

  it('single-flights concurrent async RPC snapshots without blocking the event loop', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const fixture = gitFixture(blocked)
    const inspector = createWorkspaceInspector({ gitExec: fixture.exec })
    const saved = snapshot('Review', { mode: 'uncommitted' })
    const registry = createRegistry({ persist: memoryPersist(saved), filesFor: () => files })
    const gate = { sessionId: saved.sessionId, cwd: '/work', busy: false }

    const project = vi.spyOn(inspector, 'project')
    const calls = Array.from({ length: 24 }, () => handleSidebarRpcAsync(registry, SIDEBAR_SNAPSHOT_ENDPOINT, gate, { workspace: inspector }))
    let immediate = false
    await new Promise<void>((resolve) => { setImmediate(() => { immediate = true; resolve() }) })
    expect(immediate).toBe(true)
    expect(fixture.calls).toHaveLength(5)
    expect(project).toHaveBeenCalledOnce()
    release()
    const replies = await Promise.all(calls)
    expect(replies.every((reply) => reply.ok)).toBe(true)
    expect(fixture.calls).toHaveLength(5)
    expect(project).toHaveBeenCalledOnce()

    const dispatched = await handleSidebarRpcAsync(registry, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent: { type: 'toggle-collapsed' } }, { workspace: inspector })
    expect(dispatched.ok).toBe(true)
    expect(project).toHaveBeenCalledTimes(2)
    const again = await handleSidebarRpcAsync(registry, SIDEBAR_SNAPSHOT_ENDPOINT, gate, { workspace: inspector })
    expect(again.ok).toBe(true)
    expect(project).toHaveBeenCalledTimes(3)
  })

  it('returns projected Files data while persistence stays lightweight', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-rpc-files-'))
    writeFileSync(join(root, 'selected.ts'), 'new\n')
    let stored: SidebarSnapshot | undefined
    const persist: PersistPort = {
      load() { return undefined },
      save(_id, value) { stored = value },
    }
    const exec: AsyncGitExec = async (args) => {
      if (args[0] === 'status') return '# branch.head main\0'
      if (args[0] === 'branch') return 'main\t*\n'
      if (args[0] === 'show' && args.includes('HEAD:selected.ts')) return 'old\n'
      if (args[0] === 'diff' && args.includes('--numstat')) return '1\t1\tselected.ts\n'
      return ''
    }
    const workspace = createWorkspaceInspector({ gitExec: exec })
    const registry = createRegistry({ persist, filesFor: (_id, io) => createFsFiles(io.cwdOf) })
    const result = await handleSidebarRpcAsync(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'rpc-files', cwd: root, busy: false,
      intent: { type: 'open-path', path: 'selected.ts', view: 'diff' },
    }, { workspace })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const reply = result.value as { snapshot: SidebarSnapshot }
      expect(reply.snapshot.files.preview).toBe('new\n')
      expect(reply.snapshot.files.diff?.added).toBe(1)
      expect(reply.snapshot.files.tree.some((node) => node.path === 'selected.ts')).toBe(true)
    }
    expect(stored?.files.tree).toEqual([])
    expect(stored?.files.preview).toBeUndefined()
    expect(stored?.files.diff).toBeNull()
    expect(stored?.fileStats).toEqual({})
    rmSync(root, { recursive: true, force: true })
  })

  it('returns the base snapshot and effects when projection fails', async () => {
    const saved = snapshot('Review')
    const registry = createRegistry({ persist: memoryPersist(saved), filesFor: () => files })
    const failing = {
      project: vi.fn(async () => { throw new Error('git unavailable') }),
      execCount: () => 0,
      clear() {},
    }
    const result = await handleSidebarRpcAsync(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: saved.sessionId,
      cwd: '/work',
      busy: false,
      intent: { type: 'composer-send', text: 'keep effects' },
    }, { workspace: failing })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ effects: [{ type: 'send', text: 'keep effects' }] })
    expect(failing.project).toHaveBeenCalledOnce()
  })

  it('preserves explicit hunks, deleted files, and absolute previews', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-inspector-'))
    const outside = join(root, 'outside.ts')
    writeFileSync(outside, 'outside\n')
    const calls: string[][] = []
    const exec: AsyncGitExec = async (args) => {
      calls.push([...args])
      if (args[0] === 'status') return '# branch.head main\0'
      if (args[0] === 'branch') return 'main\t*\n'
      if (args[0] === 'show' && args.includes('HEAD:deleted.ts')) return 'gone\n'
      if (args[0] === 'diff' && args.includes('--numstat')) return '0\t1\tdeleted.ts\n'
      return ''
    }
    const inspector = createWorkspaceInspector({ gitExec: exec })

    const explicitBase = snapshot('Files')
    const explicit = {
      ...explicitBase,
      files: { ...explicitBase.files, path: 'selected.ts', hunk: { before: 'old\n', after: 'new\n' } },
    }
    const explicitResult = await inspector.project(explicit, { cwd: root })
    expect(explicitResult.files.diff?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'del', text: 'old' }),
      expect.objectContaining({ kind: 'add', text: 'new' }),
    ]))
    expect(calls.some((args) => args[0] === 'show')).toBe(false)

    const deleted = {
      ...explicitBase,
      files: { ...explicitBase.files, path: 'deleted.ts', hunk: null },
    }
    const deletedResult = await inspector.project(deleted, { cwd: root })
    expect(deletedResult.files.diff?.removed).toBe(1)
    expect(deletedResult.files.diff?.lines[0]).toMatchObject({ kind: 'del', text: 'gone' })

    const absolute = {
      ...explicitBase,
      files: { ...explicitBase.files, path: outside, hunk: null },
    }
    const absoluteResult = await inspector.project(absolute, { cwd: root })
    expect(absoluteResult.files.preview).toBe('outside\n')
    const absoluteNoCwd = await inspector.project(absolute, { cwd: '' })
    expect(absoluteNoCwd.files.preview).toBe('outside\n')
    const huge = {
      ...explicitBase,
      files: { ...explicitBase.files, path: 'huge.ts', hunk: { before: '', after: Array.from({ length: 5001 }, () => 'x').join('\n') } },
    }
    const hugeResult = await inspector.project(huge, { cwd: root })
    expect(hugeResult.files.diff?.hunk).toContain('truncated')
    rmSync(root, { recursive: true, force: true })
  })

  it('parses a selected unified patch into line-numbered detail', () => {
    const parsed = parsePatch('@@ -3,2 +3,2 @@\n keep\n-old\n+new\n')
    expect(parsed?.hunk).toBe('@@ -3,2 +3,2 @@')
    expect(parsed?.lines).toEqual([
      { kind: 'ctx', text: 'keep', oldNo: 3, newNo: 3 },
      { kind: 'del', text: 'old', oldNo: 4, newNo: null },
      { kind: 'add', text: 'new', oldNo: null, newNo: 4 },
    ])
  })
})
