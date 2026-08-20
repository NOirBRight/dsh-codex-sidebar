import { describe, expect, it } from 'vitest'
import { fileDiff, lineStats } from '../src/review.ts'
import { rowHunksFromSnapshot } from '../src/tool-open.ts'

function file(n: number, mark: string): string {
  const lines: string[] = []
  for (let i = 0; i < n; i += 1) lines.push(i === 10 ? mark : 'line-' + String(i))
  return lines.join('\n') + '\n'
}

function settled(id: string, oldText: string, newText: string): Record<string, unknown> {
  return {
    kind: 'tool-result',
    callId: id,
    call: { name: 'edit', argsRaw: '{}' },
    resultView: { card: 'diff', diffs: [{ path: 'src-python/vision_proxy.py', oldText, newText }] },
    callView: null,
    subCalls: [],
  }
}

describe('diff hot path cost', () => {
  it('does not spend tens of ms computing badge stats for a long same-file transcript', () => {
    const nodes: Record<string, unknown>[] = []
    let prev = file(800, 'base')
    for (let i = 0; i < 80; i += 1) {
      const next = file(800, 'e' + String(i))
      nodes.push(settled('c' + String(i), prev, next))
      prev = next
    }
    const snap = { nodes, runningCalls: [] }
    const started = performance.now()
    const rows = rowHunksFromSnapshot(snap)
    const elapsed = performance.now() - started
    expect(rows).toHaveLength(80)
    expect(elapsed).toBeLessThan(25)
  })

  it('counts two distant insertions as +2 −0, matching the displayed LCS', () => {
    const before = [
      'installPathTakeover(): void {',
      '  const workspaces = this.#ctx.workspaces',
      '  if (workspaces === undefined || typeof workspaces.openPath !== \'function\') return',
      '  const original = workspaces.openPath.bind(workspaces)',
      '}',
    ].join('\n') + '\n'
    const after = [
      'installPathTakeover(): void {',
      '  if (this.#pathTakeover) return',
      '  const workspaces = this.#ctx.workspaces',
      '  if (workspaces === undefined || typeof workspaces.openPath !== \'function\') return',
      '  this.#pathTakeover = true',
      '  const original = workspaces.openPath.bind(workspaces)',
      '}',
    ].join('\n') + '\n'
    expect(lineStats(before, after)).toEqual({ added: 2, removed: 0 })
    expect(fileDiff(before, after)).toMatchObject({ added: 2, removed: 0 })
  })

  it('keeps a two-site edit of a large file to a small displayed hunk', () => {
    const body: string[] = []
    for (let i = 0; i < 480; i += 1) body.push('  line ' + String(i))
    const before = ['function f() {', ...body, '}'].join('\n') + '\n'
    const after = ['function f() {', '  if (guard) return', ...body.slice(0, 10), '  flag = true', ...body.slice(10), '}'].join('\n') + '\n'
    const started = performance.now()
    const diff = fileDiff(before, after)
    const elapsed = performance.now() - started
    expect(diff).toMatchObject({ added: 2, removed: 0 })
    expect(diff.lines.length).toBeLessThan(20)
    expect(elapsed).toBeLessThan(10)
  })
})
