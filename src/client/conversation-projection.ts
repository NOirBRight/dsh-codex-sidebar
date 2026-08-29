/** Official Alpha1 Chat projection for sidebar transcript consumers. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { isRecord } from '../contract.ts'
import type { ReviewChange } from '../review.ts'
import type { LogEvent } from '../side-chat.ts'
import { hunkForOpen as findHunkForOpen, rowHunksFromSnapshot, type RowHunkStat } from '../tool-open.ts'
import { logEventsFromSession, turnWritesFromSession } from '../turn-writes.ts'

export interface ConversationProjection {
  subscribe(listener: () => void): () => void
  sourceForFlowKey(key: string): unknown
  rowHunks(): readonly RowHunkStat[]
  turnWrites(): readonly ReviewChange[]
  logEvents(): readonly LogEvent[]
  hunkForOpen(path: string, tool?: string, hunkId?: string): { before: string; after: string } | undefined
}

type ConversationProjectionContext = Pick<Context, 'uiConversation'>

type DerivedProjection = {
  parserSnapshot: unknown
  rowHunks: readonly RowHunkStat[]
  turnWrites: readonly ReviewChange[]
  logEvents: readonly LogEvent[]
}

const EMPTY_DERIVED: DerivedProjection = {
  parserSnapshot: undefined,
  rowHunks: [],
  turnWrites: [],
  logEvents: [],
}

export function createConversationProjection(
  ctx: ConversationProjectionContext,
  binding: SessionBinding,
): ConversationProjection {
  const chat: ObservableSnapshot<ChatSnapshot | undefined> = ctx.uiConversation.binding(binding).target('chat')
  let cachedSource: unknown
  let cached = EMPTY_DERIVED

  const derived = (): DerivedProjection => {
    const source = chat.getSnapshot()
    if (source === cachedSource) return cached
    cachedSource = source
    const parserSnapshot = canonicalParserSnapshot(source) ?? legacyParserSnapshot(source)
    cached = parserSnapshot === undefined
      ? EMPTY_DERIVED
      : {
          parserSnapshot,
          rowHunks: rowHunksFromSnapshot(parserSnapshot),
          turnWrites: turnWritesFromSession(parserSnapshot),
          logEvents: logEventsFromSession(parserSnapshot),
        }
    return cached
  }

  return {
    subscribe: listener => chat.subscribe(listener),
    sourceForFlowKey: key => canonicalNodeSource(chat.getSnapshot(), key),
    rowHunks: () => derived().rowHunks,
    turnWrites: () => derived().turnWrites,
    logEvents: () => derived().logEvents,
    hunkForOpen: (path, tool, hunkId) => findHunkForOpen(derived().parserSnapshot, path, tool, hunkId),
  }
}

function canonicalNodeSource(snapshot: unknown, key: string): unknown {
  const node = canonicalNode(snapshot, key)
  return !isRecord(node) || !isRecord(node.data) ? undefined : node.data.source
}

function canonicalParserSnapshot(snapshot: unknown): { nodes: unknown[]; runningCalls: unknown[] } | undefined {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.order) || !isRecord(snapshot.nodes)) return undefined
  const nodes: unknown[] = []
  const runningCalls: unknown[] = []
  for (const key of snapshot.order) {
    if (typeof key !== 'string') continue
    const raw = canonicalNode(snapshot, key)
    if (!isRecord(raw) || raw.visibility === 'hidden' || !isRecord(raw.data)) continue
    const turn = locationTurn(raw.location)
    if (raw.kind === 'user' || raw.kind === 'steering' || raw.kind === 'context') {
      nodes.push(withTurn(raw.data, turn))
      continue
    }
    if (raw.kind === 'assistant-step') {
      const finalNode = raw.data.finalNode
      if (isRecord(finalNode)) nodes.push(withTurn(finalNode, turn))
      continue
    }
    if (raw.kind === 'tool-call') {
      const root = raw.data.root
      if (!isRecord(root)) continue
      const projected = withTurn(root, turn)
      if (root.kind === 'tool-result') nodes.push(projected)
      else runningCalls.push(projected)
    }
  }
  return { nodes, runningCalls }
}

function canonicalNode(snapshot: unknown, key: string): unknown {
  if (!isRecord(snapshot) || !isRecord(snapshot.nodes)) return undefined
  return typeof snapshot.nodes.get === 'function' ? snapshot.nodes.get(key) : snapshot.nodes[key]
}

function legacyParserSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot)) return undefined
  if (isRecord(snapshot.legacy)) return snapshot.legacy
  if (isRecord(snapshot.chat) && isRecord(snapshot.chat.legacy)) return snapshot.chat.legacy
  return undefined
}

function withTurn(value: Record<string, unknown>, turn: number | undefined): Record<string, unknown> {
  return turn === undefined ? value : { ...value, turn }
}

function locationTurn(value: unknown): number | undefined {
  if (!isRecord(value) || (value.kind !== 'turn' && value.kind !== 'step') || !isRecord(value.turn)) return undefined
  return typeof value.turn.turn === 'number' ? value.turn.turn : undefined
}
