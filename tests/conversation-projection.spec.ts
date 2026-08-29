import { describe, expect, it, vi } from 'vitest'
import { createConversationProjection } from '../src/client/conversation-projection.ts'

type Listener = () => void

function turnLocation(turn: number) {
  return { kind: 'turn', turn: { turn } }
}

function canonicalChat(source: unknown) {
  const edit = {
    kind: 'tool-result',
    seq: 3,
    time: 30,
    turn: 99,
    callId: 'edit-1',
    call: {
      name: 'edit',
      argsRaw: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a\n', new_string: 'a\nb\n' }),
    },
    callTime: 20,
    content: [],
    isError: false,
    subCalls: [],
  }
  const values = new Map<string, unknown>([
    ['user-1', {
      key: 'user-1', kind: 'user', target: 'chat', visibility: 'visible', anchorSeq: 1,
      location: turnLocation(1),
      data: { kind: 'user', seq: 1, time: 10, content: [{ type: 'text', text: 'please edit' }], source },
    }],
    ['tool-1', {
      key: 'tool-1', kind: 'tool-call', target: 'chat', visibility: 'visible', anchorSeq: 2,
      location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { root: edit },
    }],
  ])
  return {
    order: ['user-1', 'tool-1'],
    nodes: { get: (key: string) => values.get(key), values: () => [...values.values()] },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [1], turns: new Map() },
    legacy: { nodes: [], runningCalls: [] },
  }
}

describe('Alpha1 Conversation projection', () => {
  it('derives chips, edit rows, turn writes, logs, and hunk fallback from canonical Chat nodes', () => {
    const source = { annotations: [{ id: 'a1' }] }
    let snapshot: unknown = canonicalChat(source)
    const listeners = new Set<Listener>()
    const target = {
      getSnapshot: () => snapshot,
      subscribe(listener: Listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const targetFor = vi.fn(() => target)
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: targetFor }) },
    } as never, { sessionId: 'session-alpha1' } as never)

    expect(projection.sourceForFlowKey('user-1')).toBe(source)
    expect(projection.rowHunks()).toEqual([expect.objectContaining({
      path: 'src/a.ts', added: 1, removed: 0, before: 'a\n', after: 'a\nb\n',
    })])
    expect(projection.turnWrites()).toEqual([{ path: 'src/a.ts', before: 'a\n', after: 'a\nb\n' }])
    expect(projection.logEvents().map(event => ({ role: event.role, turn: event.turn, writes: event.writes }))).toEqual([
      { role: 'user', turn: 1, writes: undefined },
      { role: 'tool-result', turn: 1, writes: ['src/a.ts'] },
    ])
    expect(projection.hunkForOpen('src/a.ts', 'edit')).toEqual({ before: 'a\n', after: 'a\nb\n' })
    expect(targetFor).toHaveBeenCalledWith('chat')

    const notify = vi.fn()
    const dispose = projection.subscribe(notify)
    for (const listener of listeners) listener()
    expect(notify).toHaveBeenCalledOnce()
    dispose()
    snapshot = canonicalChat(source)
    for (const listener of listeners) listener()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('uses the compatibility slice only when canonical Chat readers are unavailable', () => {
    const legacyEdit = {
      kind: 'tool-result', callId: 'legacy-edit',
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'src/legacy.ts', old_string: 'x\n', new_string: 'x\ny\n' }) },
      subCalls: [],
    }
    const target = {
      getSnapshot: () => ({ legacy: { nodes: [legacyEdit], runningCalls: [] } }),
      subscribe: () => () => {},
    }
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: () => target }) },
    } as never, { sessionId: 'session-legacy' } as never)

    expect(projection.rowHunks()).toEqual([expect.objectContaining({ path: 'src/legacy.ts', added: 1 })])
    expect(projection.turnWrites()).toEqual([{ path: 'src/legacy.ts', before: 'x\n', after: 'x\ny\n' }])
  })
})
