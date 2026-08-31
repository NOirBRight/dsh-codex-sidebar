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
type ParserSnapshot = { nodes: unknown[]; runningCalls: unknown[] }
type ProjectionState = { source: unknown; version: number }
type RelatedNodeKind = 'user' | 'steering' | 'context' | 'tool-call' | 'tool-result'
type RelatedNodeFingerprintEntry = {
  key: string
  kind: RelatedNodeKind
  node: Record<string, unknown>
  data: Record<string, unknown>
  root: unknown
  source: unknown
  state: string
}
type RelatedFingerprint =
  | { kind: 'canonical'; entries: readonly RelatedNodeFingerprintEntry[] }
  | { kind: 'legacy'; snapshot: unknown }

/**
 * Create lazy, independently cached views over one Chat binding.
 * @param ctx - Client context that resolves Chat targets.
 * @param binding - Session binding whose Chat target supplies the snapshot.
 * @returns a projection with semantic invalidation and lazy derived views.
 */
export function createConversationProjection(
  ctx: ConversationProjectionContext,
  binding: SessionBinding,
): ConversationProjection {
  const chat: ObservableSnapshot<ChatSnapshot | undefined> = ctx.uiConversation.binding(binding).target('chat')
  let fingerprintSource: unknown = chat.getSnapshot()
  let fingerprint = relatedFingerprint(fingerprintSource)
  let version = 0
  let parserVersion = -1
  let parserSnapshot: unknown
  let rowVersion = -1
  let rows: readonly RowHunkStat[] = []
  let writeVersion = -1
  let writes: readonly ReviewChange[] = []
  const unsetLogSource = Symbol('unset log source')
  let logSource: unknown = unsetLogSource
  let logs: readonly LogEvent[] = []
  const subscribers = new Set<() => void>()
  let stopChatSubscription: (() => void) | undefined

  const observeSource = (source: unknown): boolean => {
    if (source === fingerprintSource) return false
    fingerprintSource = source
    const next = relatedFingerprint(source)
    if (sameRelatedFingerprint(fingerprint, next)) return false
    fingerprint = next
    version++
    return true
  }

  const current = (): ProjectionState => {
    const source = chat.getSnapshot()
    observeSource(source)
    return { source, version }
  }

  const parserFor = (state: ProjectionState): unknown => {
    if (parserVersion === state.version) return parserSnapshot
    parserVersion = state.version
    parserSnapshot = canonicalParserSnapshot(state.source) ?? legacyParserSnapshot(state.source)
    return parserSnapshot
  }

  const rowHunks = (): readonly RowHunkStat[] => {
    const state = current()
    if (rowVersion !== state.version) {
      rowVersion = state.version
      const parser = parserFor(state)
      rows = rowHunksFromSnapshot(parser)
    }
    return rows
  }

  const turnWrites = (): readonly ReviewChange[] => {
    const state = current()
    if (writeVersion !== state.version) {
      writeVersion = state.version
      const parser = parserFor(state)
      writes = turnWritesFromSession(parser)
    }
    return writes
  }

  const logEvents = (): readonly LogEvent[] => {
    const source = chat.getSnapshot()
    if (logSource !== source) {
      logSource = source
      const parser = canonicalParserSnapshot(source) ?? legacyParserSnapshot(source)
      logs = logEventsFromSession(parser)
    }
    return logs
  }

  const refreshFingerprint = (): boolean => observeSource(chat.getSnapshot())

  const onChatChange = (): void => {
    if (!refreshFingerprint()) return
    for (const listener of [...subscribers]) listener()
  }

  const subscribe = (listener: () => void): (() => void) => {
    subscribers.add(listener)
    if (subscribers.size === 1) {
      refreshFingerprint()
      stopChatSubscription = chat.subscribe(onChatChange)
    }
    return () => {
      if (!subscribers.delete(listener)) return
      if (subscribers.size !== 0) return
      stopChatSubscription?.()
      stopChatSubscription = undefined
    }
  }

  return {
    subscribe,
    sourceForFlowKey: key => canonicalNodeSource(chat.getSnapshot(), key),
    rowHunks,
    turnWrites,
    logEvents,
    hunkForOpen: (path, tool, hunkId) => findHunkForOpen(parserFor(current()), path, tool, hunkId),
  }
}

function relatedFingerprint(snapshot: unknown): RelatedFingerprint {
  const canonical = canonicalRelatedFingerprint(snapshot)
  if (canonical !== undefined) return canonical
  return { kind: 'legacy', snapshot }
}

function canonicalRelatedFingerprint(snapshot: unknown): RelatedFingerprint | undefined {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.order) || !isRecord(snapshot.nodes)) return undefined
  const entries: RelatedNodeFingerprintEntry[] = []
  for (const key of snapshot.order) {
    if (typeof key !== 'string') continue
    const node = canonicalNode(snapshot, key)
    if (!isRecord(node) || node.visibility === 'hidden' || !isRecord(node.data)) continue
    if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') {
      entries.push({
        key,
        kind: node.kind,
        node,
        data: node.data,
        root: undefined,
        source: node.data.source,
        state: '',
      })
      continue
    }
    if (node.kind !== 'tool-call' && node.kind !== 'tool-result') continue
    const root = node.data.root
    entries.push({
      key,
      kind: node.kind,
      node,
      data: node.data,
      root,
      source: undefined,
      state: isRecord(root) && typeof root.kind === 'string' ? root.kind : '',
    })
  }
  return { kind: 'canonical', entries }
}

function sameRelatedFingerprint(a: RelatedFingerprint, b: RelatedFingerprint): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'legacy' && b.kind === 'legacy') return a.snapshot === b.snapshot
  if (a.kind !== 'canonical' || b.kind !== 'canonical' || a.entries.length !== b.entries.length) return false
  for (let index = 0; index < a.entries.length; index++) {
    const left = a.entries[index]
    const right = b.entries[index]
    if (left === undefined || right === undefined) return false
    if (left.key !== right.key || left.kind !== right.kind || left.node !== right.node || left.data !== right.data) return false
    if (left.root !== right.root || left.source !== right.source || left.state !== right.state) return false
  }
  return true
}

function canonicalNodeSource(snapshot: unknown, key: string): unknown {
  const node = canonicalNode(snapshot, key)
  return !isRecord(node) || !isRecord(node.data) ? undefined : node.data.source
}

function canonicalParserSnapshot(snapshot: unknown): ParserSnapshot | undefined {
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
    if (raw.kind !== 'tool-call' && raw.kind !== 'tool-result') continue
    const root = raw.data.root
    if (!isRecord(root)) continue
    const projected = withTurn(root, turn)
    if (raw.kind === 'tool-result' || root.kind === 'tool-result') nodes.push(projected)
    else runningCalls.push(projected)
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
