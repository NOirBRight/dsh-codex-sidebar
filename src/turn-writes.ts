/** 本轮变更 from a 主会话 log: current or latest unfinished turn's tool writes. */

import type { ReviewChange } from './review.ts'
import type { LogEvent } from './side-chat.ts'
import { isRecord } from './contract.ts'
import { reviewChangesFromSnapshot } from './tool-open.ts'

export function turnWritesFromSession(snapshot: unknown): ReviewChange[] {
  const fromHunks = latestTurnChanges(snapshot)
  if (fromHunks.length > 0) return fromHunks
  const fromLog = turnWritesFromLog(logEventsFrom(snapshot))
  if (fromLog.length > 0) return fromLog
  return turnWritesFromLog(conversationNodesToEvents(snapshot))
}

function latestTurnChanges(snapshot: unknown): ReviewChange[] {
  const nodes = nodesOf(snapshot)
  if (nodes.length === 0) return reviewChangesFromSnapshot(snapshot)
  let maxTurn = 1
  for (const node of nodes) {
    if (isRecord(node) && typeof node.turn === 'number' && node.turn > maxTurn) maxTurn = node.turn
  }
  const latest = nodes.filter((node) => !isRecord(node) || typeof node.turn !== 'number' || node.turn === maxTurn)
  return reviewChangesFromSnapshot({ nodes: latest, runningCalls: isRecord(snapshot) ? snapshot.runningCalls : [] })
}

export function turnWritesFromLog(events: readonly LogEvent[]): ReviewChange[] {
  if (events.length === 0) return []
  const turn = Math.max(...events.map((event) => event.turn))
  const byPath = new Map<string, ReviewChange>()
  for (const event of events) {
    if (event.turn !== turn) continue
    for (const path of event.writes ?? []) {
      const prev = byPath.get(path)
      const after = event.after ?? (event.role === 'tool-result' && event.text.length > 0 ? event.text : prev?.after ?? '')
      const before = prev?.before ?? event.before ?? ''
      byPath.set(path, { path, before, after })
    }
  }
  return [...byPath.values()]
}

function logEventsFrom(snapshot: unknown): LogEvent[] {
  if (Array.isArray(snapshot)) return flattenEvents(snapshot)
  if (!isRecord(snapshot)) return []
  if (Array.isArray(snapshot.log)) return flattenEvents(snapshot.log)
  if (Array.isArray(snapshot.messages)) return messagesToEvents(snapshot.messages)
  if (isRecord(snapshot.session) && Array.isArray(snapshot.session.messages)) {
    return messagesToEvents(snapshot.session.messages)
  }
  return []
}

function flattenEvents(raw: unknown[]): LogEvent[] {
  const events: LogEvent[] = []
  for (const item of raw) {
    const event = asLogEvent(item)
    if (event !== undefined) events.push(event)
  }
  return events
}

function asLogEvent(item: unknown): LogEvent | undefined {
  if (!isRecord(item)) return undefined
  if (typeof item.seq !== 'number' || typeof item.turn !== 'number' || typeof item.role !== 'string') {
    return undefined
  }
  if (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'tool-call' && item.role !== 'tool-result') {
    return undefined
  }
  const writes = stringList(item.writes)
  return {
    seq: item.seq,
    turn: item.turn,
    role: item.role,
    text: typeof item.text === 'string' ? item.text : '',
    ...typeof item.closed === 'boolean' ? { closed: item.closed } : {},
    ...writes.length === 0 ? {} : { writes },
  }
}

function messagesToEvents(messages: unknown[]): LogEvent[] {
  const events: LogEvent[] = []
  let turn = 0
  let seq = 0
  for (const message of messages) {
    if (!isRecord(message)) continue
    const role = messageRole(message.role)
    if (role === 'user') turn += 1
    const writes = writesOf(message)
    const text = textOf(message)
    const closed = message.closed === false ? false : true
    seq += 1
    events.push({
      seq,
      turn: turn === 0 ? 1 : turn,
      role,
      text,
      ...role === 'assistant' ? { closed } : {},
      ...writes.length === 0 ? {} : { writes },
    })
  }
  return events
}

function messageRole(role: unknown): LogEvent['role'] {
  if (role === 'assistant' || role === 'tool-call' || role === 'tool-result') return role
  if (role === 'tool') return 'tool-result'
  return 'user'
}

function writesOf(message: Record<string, unknown>): string[] {
  const direct = stringList(message.writes)
  if (direct.length > 0) return direct
  const content = message.content
  if (!Array.isArray(content)) return typeof message.path === 'string' && message.path.length > 0 ? [message.path] : []
  const paths: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    for (const path of stringList(block.writes)) {
      if (!paths.includes(path)) paths.push(path)
    }
    if (typeof block.path === 'string' && block.path.length > 0 && !paths.includes(block.path)) {
      paths.push(block.path)
    }
  }
  return paths
}

function textOf(message: Record<string, unknown>): string {
  if (typeof message.text === 'string') return message.text
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (!isRecord(block)) continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) out.push(item)
  }
  return out
}

const WRITE_TOOL = /^(write|edit|str_replace|strreplace|search_replace|apply_patch|notebook)/i

export function logEventsFromSession(snapshot: unknown): LogEvent[] {
  const direct = logEventsFrom(snapshot)
  if (direct.length > 0) return direct
  return conversationNodesToEvents(snapshot)
}

function conversationNodesToEvents(snapshot: unknown): LogEvent[] {
  const nodes = nodesOf(snapshot)
  const events: LogEvent[] = []
  let seq = 0
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.kind !== 'string') continue
    seq += 1
    const turn = typeof node.turn === 'number' ? node.turn : 1
    if (node.kind === 'user') {
      events.push({ seq, turn, role: 'user', text: nodeText(node) })
      continue
    }
    if (node.kind === 'assistant') {
      events.push({
        seq,
        turn,
        role: 'assistant',
        text: nodeText(node),
        closed: node.interrupted === true ? false : true,
      })
      continue
    }
    if (node.kind === 'tool-result' || node.kind === 'tool-call') {
      emitTool(node, turn, events, () => { seq += 1; return seq })
    }
  }
  return events
}

function emitTool(
  node: Record<string, unknown>,
  turn: number,
  events: LogEvent[],
  nextSeq: () => number,
): void {
  const call = isRecord(node.call) ? node.call : node
  const name = typeof call.name === 'string' ? call.name : typeof node.name === 'string' ? node.name : ''
  const argsRaw = typeof call.argsRaw === 'string' ? call.argsRaw : typeof node.argsRaw === 'string' ? node.argsRaw : ''
  const writes = WRITE_TOOL.test(name) ? pathsFromArgs(argsRaw) : []
  const kind = node.kind === 'tool-call' ? 'tool-call' : 'tool-result'
  if (writes.length > 0 || WRITE_TOOL.test(name)) {
    events.push({
      seq: nextSeq(),
      turn,
      role: kind,
      text: nodeText(node) || `${name} ${argsRaw}`.trim(),
      ...writes.length === 0 ? {} : { writes },
    })
  }
  if (!Array.isArray(node.subCalls)) return
  for (const child of node.subCalls) {
    if (isRecord(child)) emitTool(child, turn, events, nextSeq)
  }
}

function nodesOf(snapshot: unknown): unknown[] {
  if (!isRecord(snapshot)) return []
  if (Array.isArray(snapshot.nodes)) return snapshot.nodes
  if (isRecord(snapshot.chat) && isRecord(snapshot.chat.legacy) && Array.isArray(snapshot.chat.legacy.nodes)) {
    return snapshot.chat.legacy.nodes
  }
  return []
}

function nodeText(node: Record<string, unknown>): string {
  if (typeof node.text === 'string') return node.text
  const blocks = Array.isArray(node.blocks) ? node.blocks : Array.isArray(node.content) ? node.content : []
  const parts: string[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

function pathsFromArgs(raw: string): string[] {
  if (raw.length === 0) return []
  try {
    const args: unknown = JSON.parse(raw)
    if (!isRecord(args)) return []
    const paths: string[] = []
    for (const key of ['file_path', 'path', 'target_file', 'target']) {
      const value = args[key]
      if (typeof value === 'string' && value.length > 0) paths.push(value)
    }
    return paths
  } catch {
    return []
  }
}

