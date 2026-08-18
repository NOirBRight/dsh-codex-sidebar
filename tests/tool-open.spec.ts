import { describe, expect, it } from 'vitest'
import { hunkForOpen, statForLabel, statsFromSnapshot, viewForTool } from '../src/tool-open.ts'

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
})
