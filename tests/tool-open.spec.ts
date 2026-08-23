import { describe, expect, it } from 'vitest'
import { hunkForOpen, queueRowStats, rowHunksFromSnapshot, rowStatsFromSnapshot, sameRowHunks, statForLabel, statsFromSnapshot, takeRowHunk, takeRowStat, viewForTool } from '../src/tool-open.ts'

type DiffHunk = { path: string; oldText: string | null; newText: string }

function diffView(...diffs: DiffHunk[]): { card: 'diff'; diffs: DiffHunk[] } {
  return { card: 'diff', diffs }
}

function settled(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2_000,
    callId: 'settled',
    call: { name: 'edit', argsRaw: '{}' },
    callTime: 1_000,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...over,
  }
}

function running(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: 'running',
    name: 'write',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 1_000,
    callView: null,
    subCalls: [],
    ...over,
  }
}

describe('tool-open', () => {
  it('opens edit/write as Diff and read/link as preview', () => {
    expect(viewForTool('edit')).toBe('diff')
    expect(viewForTool('write')).toBe('diff')
    expect(viewForTool('str_replace')).toBe('diff')
    expect(viewForTool('read')).toBe('preview')
    expect(viewForTool(undefined)).toBe('preview')
  })

  it('matches a tool-row label to fileStats', () => {
    const stats = { 'src/client/FilesPane.tsx': { added: 12, removed: 4 } }
    expect(statForLabel(stats, 'src/client/FilesPane.tsx')).toEqual({ added: 12, removed: 4 })
    expect(statForLabel(stats, 'FilesPane.tsx')).toEqual({ added: 12, removed: 4 })
    expect(statForLabel(stats, '/tmp/dsh-host-wire/src/client/FilesPane.tsx')).toEqual({ added: 12, removed: 4 })
    expect(statForLabel(stats, 'other.ts')).toBeUndefined()
  })

  it('reads public tool calls without touching the snapshot view registry', () => {
    let viewReads = 0
    const views = Object.defineProperty({}, 'diffs', {
      enumerable: true,
      get() {
        viewReads += 1
        throw new Error('cannot get property "diffs" without inject')
      },
    })
    const snap = {
      nodes: [settled({
        resultView: diffView(
          { path: 'src/tool-open.ts', oldText: null, newText: 'a\nb\nc\n' },
          { path: 'src/client/tool-stats.ts', oldText: 'keep\n', newText: 'keep\nplus\n' },
        ),
      })],
      runningCalls: [],
      views,
      unrelated: diffView({ path: 'ignored.ts', oldText: null, newText: 'ignore\n' }),
    }

    expect(statsFromSnapshot(snap)).toEqual({
      'src/tool-open.ts': { added: 3, removed: 0 },
      'src/client/tool-stats.ts': { added: 1, removed: 0 },
    })
    expect(viewReads).toBe(0)
  })

  it('uses a settled call result instead of double-counting its call view', () => {
    const snap = {
      nodes: [settled({
        callView: diffView({ path: 'src/result.ts', oldText: 'before\n', newText: 'call\n' }),
        resultView: diffView({ path: 'src/result.ts', oldText: 'before\n', newText: 'actual\nextra\n' }),
      })],
      runningCalls: [],
    }

    expect(statsFromSnapshot(snap)).toEqual({
      'src/result.ts': { added: 2, removed: 1 },
    })
  })

  it('falls back to a settled call view when its result has no usable diff', () => {
    const snap = {
      nodes: [settled({
        callView: diffView({ path: 'src/fallback.ts', oldText: 'old\n', newText: 'new\n' }),
        resultView: {
          card: 'diff',
          diffs: [{ path: 'ignored.ts', oldText: 42, newText: 'bad\n' }],
        },
      })],
      runningCalls: [],
    }

    expect(statsFromSnapshot(snap)).toEqual({
      'src/fallback.ts': { added: 1, removed: 1 },
    })
  })

  it('uses running call views and recursively aggregates nested calls by path', () => {
    const snap = {
      nodes: [],
      runningCalls: [running({
        callView: diffView(
          { path: 'src/a.ts', oldText: null, newText: 'one\n' },
          { path: 'src/b.ts', oldText: 'gone\n', newText: '' },
        ),
        subCalls: [
          running({
            callId: 'running-child',
            callView: diffView({ path: 'src/a.ts', oldText: 'one\n', newText: 'one\ntwo\n' }),
          }),
          settled({
            callId: 'settled-child',
            resultView: diffView({ path: 'src/b.ts', oldText: null, newText: 'new\n' }),
          }),
        ],
      })],
    }

    expect(statsFromSnapshot(snap)).toEqual({
      'src/a.ts': { added: 2, removed: 0 },
      'src/b.ts': { added: 1, removed: 1 },
    })
  })

  it('ignores malformed and non-diff views', () => {
    const fakeDiff = [{ path: 'ignored.ts', oldText: null, newText: 'ignore\n' }]
    const snap = {
      nodes: [
        { kind: 'assistant', resultView: { card: 'diff', diffs: fakeDiff } },
        settled({
          callView: { card: 'generic', diffs: fakeDiff },
          resultView: { card: 'diff', diffs: [{ path: 'broken.ts', oldText: false, newText: 'x\n' }] },
        }),
      ],
      runningCalls: [running({ callView: { card: 'terminal', diffs: fakeDiff } })],
    }

    expect(statsFromSnapshot(snap)).toEqual({})
  })

  it('reads run_code nested write/edit from argsRaw and result content', () => {
    const snap = {
      nodes: [settled({
        call: { name: 'run_code', argsRaw: '{"code":"write()"}' },
        resultView: { card: 'generic' },
        subCalls: [{
          kind: 'tool-result',
          seq: 3,
          time: 3_000,
          callId: 'write-1',
          call: {
            name: 'write',
            argsRaw: JSON.stringify({
              file_path: '/tmp/ws/diff-display-test.md',
              content: '# created\n',
            }),
          },
          callTime: 2_000,
          content: [{ type: 'text', text: JSON.stringify({
            path: '/tmp/ws/diff-display-test.md',
            operation: 'create',
            before: null,
            after: '# created\n',
          }) }],
          isError: false,
          callView: null,
          resultView: null,
          subCalls: [],
        }, {
          kind: 'tool-result',
          seq: 4,
          time: 4_000,
          callId: 'edit-1',
          call: {
            name: 'edit',
            argsRaw: JSON.stringify({
              file_path: '/tmp/ws/diff-display-test.md',
              old_string: '# created\n',
              new_string: '# created\n# extra\n',
            }),
          },
          callTime: 3_000,
          content: [],
          isError: false,
          callView: null,
          resultView: null,
          subCalls: [],
        }],
      })],
      runningCalls: [],
    }
    const stats = statsFromSnapshot(snap)
    expect(stats['/tmp/ws/diff-display-test.md']?.added).toBeGreaterThan(0)
    expect(hunkForOpen(snap, 'diff-display-test.md', 'edit')).toEqual({
      before: '# created\n',
      after: '# created\n# extra\n',
    })
    expect(hunkForOpen(snap, 'diff-display-test.md', 'write')?.before).toBe('')
  })

  it('opens the exact same-file hunk selected from an old transcript', () => {
    const snap = {
      nodes: [
        settled({ callId: 'old-1', resultView: diffView({ path: 'src-python/gateway_transport.py', oldText: 'old\n', newText: '' }) }),
        settled({ callId: 'old-2', resultView: diffView({ path: 'src-python/gateway_transport.py', oldText: 'a\n', newText: 'a\nb\n' }) }),
        settled({ callId: 'old-3', resultView: diffView({ path: 'src-python/gateway_transport.py', oldText: 'x\n', newText: 'y\n' }) }),
      ],
      runningCalls: [],
    }
    const rows = rowHunksFromSnapshot(snap)
    expect(rows.map((row) => row.hunkId)).toEqual(['0', '1', '2'])
    const pending = queueRowStats(rows)
    expect(takeRowHunk(pending, 'gateway_transport.py')?.hunkId).toBe('0')
    expect(takeRowHunk(pending, 'gateway_transport.py')?.hunkId).toBe('1')
    expect(hunkForOpen(snap, 'gateway_transport.py', 'edit', '1')).toEqual({ before: 'a\n', after: 'a\nb\n' })
    expect(hunkForOpen(snap, 'gateway_transport.py', 'edit', '0')).toEqual({ before: 'old\n', after: '' })
  })

  it('preserves the exact before/after payload while queueing same-file rows', () => {
    const snap = {
      nodes: [
        settled({ callId: 'payload-1', resultView: diffView({ path: 'src-python/vision_proxy.py', oldText: 'old\n', newText: '' }) }),
        settled({ callId: 'payload-2', resultView: diffView({ path: 'src-python/vision_proxy.py', oldText: 'keep\n', newText: 'keep\nplus\n' }) }),
      ],
      runningCalls: [],
    }
    const rows = rowHunksFromSnapshot(snap)
    const pending = queueRowStats(rows)

    expect(takeRowHunk(pending, 'vision_proxy.py')).toMatchObject({
      hunkId: rows[0]?.hunkId,
      before: 'old\n',
      after: '',
    })
    expect(takeRowHunk(pending, 'src-python/vision_proxy.py')).toMatchObject({
      hunkId: rows[1]?.hunkId,
      before: 'keep\n',
      after: 'keep\nplus\n',
    })
  })

  it('hands each edit of the same file its own increment, in log order', () => {
    const snap = {
      nodes: [
        settled({
          callId: 'e1',
          resultView: diffView({ path: 'src-python/route_plan.py', oldText: 'a\n', newText: 'a\nb\n' }),
        }),
        settled({
          callId: 'e2',
          resultView: diffView({ path: 'src-python/route_plan.py', oldText: 'a\nb\n', newText: 'a\n' }),
        }),
        settled({
          callId: 'e3',
          resultView: diffView({ path: 'src-python/route_plan.py', oldText: 'keep\n', newText: 'keep\nplus\n' }),
        }),
      ],
      runningCalls: [],
    }
    expect(statsFromSnapshot(snap)['src-python/route_plan.py']).toEqual({ added: 2, removed: 1 })
    expect(rowStatsFromSnapshot(snap)).toEqual([
      { path: 'src-python/route_plan.py', added: 1, removed: 0 },
      { path: 'src-python/route_plan.py', added: 0, removed: 1 },
      { path: 'src-python/route_plan.py', added: 1, removed: 0 },
    ])
    const pending = queueRowStats(rowStatsFromSnapshot(snap))
    expect(takeRowStat(pending, 'route_plan.py')).toEqual({ added: 1, removed: 0 })
    expect(takeRowStat(pending, 'src-python/route_plan.py')).toEqual({ added: 0, removed: 1 })
    expect(takeRowStat(pending, 'src-python/route_plan.py')).toEqual({ added: 1, removed: 0 })
    expect(takeRowStat(pending, 'src-python/route_plan.py')).toBeUndefined()
  })

  it('reuses hunks from an unchanged settled node across snapshot objects', () => {
    let reads = 0
    const diffs = [{ path: 'src/cached.ts', oldText: 'old\n', newText: 'new\n' }]
    const resultView = {
      card: 'diff',
      get diffs() {
        reads += 1
        return diffs
      },
    }
    const node = settled({ callId: 'cached-settled', resultView })
    expect(statsFromSnapshot({ nodes: [node], runningCalls: [] })).toEqual({
      'src/cached.ts': { added: 1, removed: 1 },
    })
    const afterFirst = reads
    expect(afterFirst).toBeGreaterThan(0)
    expect(statsFromSnapshot({
      nodes: [node],
      runningCalls: [running({ callView: diffView({ path: 'src/live.ts', oldText: null, newText: 'x\n' }) })],
    })).toEqual({
      'src/cached.ts': { added: 1, removed: 1 },
      'src/live.ts': { added: 1, removed: 0 },
    })
    expect(reads).toBe(afterFirst)
  })

  it('treats identical row hunks as unchanged across snapshot objects', () => {
    const snap = {
      nodes: [
        settled({ callId: 'same', resultView: diffView({ path: 'src/a.ts', oldText: 'a\n', newText: 'b\n' }) }),
      ],
      runningCalls: [],
    }
    const left = rowHunksFromSnapshot(snap)
    const right = rowHunksFromSnapshot({ ...snap })
    expect(left).not.toBe(right)
    expect(sameRowHunks(left, right)).toBe(true)
    expect(sameRowHunks(left, [])).toBe(false)
  })
})
