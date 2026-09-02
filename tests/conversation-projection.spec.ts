import { afterEach, describe, expect, it, vi } from 'vitest'
import * as toolOpen from '../src/tool-open.ts'
import * as turnWrites from '../src/turn-writes.ts'
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
  return canonicalSnapshot(values, ['user-1', 'tool-1'])
}

function canonicalSnapshot(values: Map<string, unknown>, order: string[]) {
  return {
    order,
    nodes: { get: (key: string) => values.get(key), values: () => [...values.values()] },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [1], turns: new Map() },
  }
}

type ProjectionRelatedNodes = {
  user: Record<string, unknown>
  tool?: Record<string, unknown>
}

function relatedNodes(source: unknown, toolRoot?: unknown): ProjectionRelatedNodes {
  const related: ProjectionRelatedNodes = {
    user: {
      key: 'user-1', kind: 'user', target: 'chat', visibility: 'visible', anchorSeq: 1,
      location: turnLocation(1),
      data: { kind: 'user', seq: 1, time: 10, content: [{ type: 'text', text: 'please edit' }], source },
    },
  }
  if (toolRoot !== undefined) {
    related.tool = {
      key: 'tool-1', kind: 'tool-call', target: 'chat', visibility: 'visible', anchorSeq: 2,
      location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
      data: { root: toolRoot },
    }
  }
  return related
}

function canonicalChatWithAssistant(source: unknown, assistantText: string, related: ProjectionRelatedNodes) {
  const entries: Array<[string, unknown]> = [
    ['user-1', related.user],
    ['assistant-1', {
      key: 'assistant-1', kind: 'assistant-step', target: 'chat', visibility: 'visible', anchorSeq: 2,
      location: { kind: 'step', turn: { turn: 1 }, step: { step: 2 } },
      data: { finalNode: { kind: 'assistant', seq: 2, content: [{ type: 'text', text: assistantText }] } },
    }],
  ]
  const order = ['user-1', 'assistant-1']
  if (related.tool !== undefined) {
    entries.push(['tool-1', related.tool])
    order.push('tool-1')
  }
  return canonicalSnapshot(new Map(entries), order)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Alpha4 Conversation projection', () => {
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
    } as never, { sessionId: 'session-alpha4' } as never)

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
    snapshot = canonicalChat({ annotations: [{ id: 'a2' }] })
    for (const listener of listeners) listener()
    expect(notify).toHaveBeenCalledOnce()
    dispose()
    snapshot = canonicalChat(source)
    for (const listener of listeners) listener()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('degrades all derived views when alpha4 Chat data is unavailable', () => {
    const target = {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    }
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: () => target }) },
    } as never, { sessionId: 'session-unavailable' } as never)

    expect(projection.sourceForFlowKey('user-1')).toBeUndefined()
    expect(projection.rowHunks()).toEqual([])
    expect(projection.turnWrites()).toEqual([])
    expect(projection.logEvents()).toEqual([])
    expect(projection.hunkForOpen('src/a.ts', 'edit')).toBeUndefined()
  })

  it('does not notify or recompute related derived values for assistant text snapshots', () => {
    const source = { annotations: [{ id: 'a1' }] }
    const completeRoot = {
      kind: 'tool-result', callId: 'edit-1',
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a\n', new_string: 'a\nb\n' }) },
      subCalls: [],
    }
    const related = relatedNodes(source, completeRoot)
    let snapshot: unknown = canonicalChatWithAssistant(source, 'draft', related)
    const listeners = new Set<Listener>()
    const target = {
      getSnapshot: () => snapshot,
      subscribe(listener: Listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: () => target }) },
    } as never, { sessionId: 'session-assistant' } as never)
    const rowSpy = vi.spyOn(toolOpen, 'rowHunksFromSnapshot')
    const writeSpy = vi.spyOn(turnWrites, 'turnWritesFromSession')
    const logSpy = vi.spyOn(turnWrites, 'logEventsFromSession')

    const rows = projection.rowHunks()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    const writes = projection.turnWrites()
    expect(writes).toEqual([{ path: 'src/a.ts', before: 'a\n', after: 'a\nb\n' }])
    expect(logSpy).not.toHaveBeenCalled()
    const logs = projection.logEvents()
    expect(logs).toHaveLength(3)
    expect(rowSpy).toHaveBeenCalledOnce()
    expect(writeSpy).toHaveBeenCalledOnce()
    expect(logSpy).toHaveBeenCalledOnce()

    const notify = vi.fn()
    const dispose = projection.subscribe(notify)
    for (let i = 0; i < 100; i++) {
      snapshot = canonicalChatWithAssistant(source, `draft-${i}`, related)
      for (const listener of [...listeners]) listener()
      expect(projection.rowHunks()).toBe(rows)
      expect(projection.turnWrites()).toBe(writes)
    }
    expect(notify).not.toHaveBeenCalled()
    expect(rowSpy).toHaveBeenCalledOnce()
    expect(writeSpy).toHaveBeenCalledOnce()
    expect(logSpy).toHaveBeenCalledOnce()
    dispose()
  })

  it('refreshes assistant logs lazily without invalidating related caches', () => {
    const source = { annotations: [{ id: 'a1' }] }
    const completeRoot = {
      kind: 'tool-result', callId: 'edit-1',
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a\n', new_string: 'a\nb\n' }) },
      subCalls: [],
    }
    const related = relatedNodes(source, completeRoot)
    let snapshot: unknown = canonicalChatWithAssistant(source, 'draft-0', related)
    const listeners = new Set<Listener>()
    const target = {
      getSnapshot: () => snapshot,
      subscribe(listener: Listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: () => target }) },
    } as never, { sessionId: 'session-log-lazy' } as never)
    const rowSpy = vi.spyOn(toolOpen, 'rowHunksFromSnapshot')
    const writeSpy = vi.spyOn(turnWrites, 'turnWritesFromSession')
    const logSpy = vi.spyOn(turnWrites, 'logEventsFromSession')
    const rows = projection.rowHunks()
    const writes = projection.turnWrites()
    expect(logSpy).not.toHaveBeenCalled()

    const notify = vi.fn()
    const dispose = projection.subscribe(notify)
    for (let i = 0; i < 100; i++) {
      snapshot = canonicalChatWithAssistant(source, `draft-${i}`, related)
      for (const listener of [...listeners]) listener()
    }
    expect(notify).not.toHaveBeenCalled()
    expect(rowSpy).toHaveBeenCalledOnce()
    expect(writeSpy).toHaveBeenCalledOnce()
    expect(logSpy).not.toHaveBeenCalled()

    const logs = projection.logEvents()
    expect(logs.find((event) => event.role === 'assistant')?.text).toBe('draft-99')
    expect(logSpy).toHaveBeenCalledOnce()
    expect(projection.rowHunks()).toBe(rows)
    expect(projection.turnWrites()).toBe(writes)
    expect(logSpy).toHaveBeenCalledOnce()
    dispose()
  })

  it('notifies once when a tool is added, completed, or receives new user annotations', () => {
    const source = { annotations: [] }
    const runningRoot = {
      callId: 'edit-1',
      call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a\n', new_string: 'a\nb\n' }) },
      subCalls: [],
    }
    const completeRoot = { ...runningRoot, kind: 'tool-result' }
    const initialRelated = relatedNodes(source)
    let snapshot: unknown = canonicalChatWithAssistant(source, 'draft', initialRelated)
    const listeners = new Set<Listener>()
    const target = {
      getSnapshot: () => snapshot,
      subscribe(listener: Listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const projection = createConversationProjection({
      uiConversation: { binding: () => ({ target: () => target }) },
    } as never, { sessionId: 'session-related' } as never)
    const notify = vi.fn()
    const dispose = projection.subscribe(notify)
    const emit = (): void => { for (const listener of [...listeners]) listener() }

    const runningRelated = relatedNodes(source, runningRoot)
    snapshot = canonicalChatWithAssistant(source, 'draft-1', runningRelated)
    emit()
    expect(notify).toHaveBeenCalledTimes(1)

    snapshot = canonicalChatWithAssistant(source, 'draft-2', runningRelated)
    emit()
    expect(notify).toHaveBeenCalledTimes(1)

    const completedRelated = relatedNodes(source, completeRoot)
    snapshot = canonicalChatWithAssistant(source, 'draft-3', completedRelated)
    emit()
    expect(notify).toHaveBeenCalledTimes(2)

    const annotatedSource = { annotations: [{ id: 'a1' }] }
    const annotatedRelated = relatedNodes(annotatedSource, completeRoot)
    annotatedRelated.tool = completedRelated.tool
    snapshot = canonicalChatWithAssistant(annotatedSource, 'draft-4', annotatedRelated)
    emit()
    expect(notify).toHaveBeenCalledTimes(3)
    expect(projection.sourceForFlowKey('user-1')).toBe(annotatedSource)
    dispose()
  })
})
