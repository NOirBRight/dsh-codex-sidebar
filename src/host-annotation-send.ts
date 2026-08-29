/** Stage 批注 evidence and splice it into the claimed user message at pre-step. */

import {
  fileSnippet,
  hydrateAnnotation,
  toMarkView,
  type AnnotationMarkView,
} from './annotation.ts'
import { formatEvidenceSend } from './send-text.ts'
import type { Annotation, BrowserEvidence } from './session.ts'

export type ImageAttachmentRef = {
  attachmentId: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
}

export const MAX_ANNOTATION_IMAGES = 20
export const STAGE_TTL_MS = 30_000

export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = { type: 'image'; attachment: ImageAttachmentRef }
export type UserContentBlock = TextBlock | ImageBlock

export type EnrichableMessage = {
  id: string
  role: 'user'
  content: readonly UserContentBlock[]
  source: unknown
}

export type StagedAnnotationBatch = {
  sessionId: string
  attachments: Annotation[]
  marks: AnnotationMarkView[]
  images: Array<{ evidenceId: string; attachment: ImageAttachmentRef }>
  evidenceText: string
  expiresAt: number
}

export type AnnotationSendPorts = {
  now?: () => number
  ttlMs?: number
  readFile?: (path: string) => string | undefined
  saveImage?: (input: { data: Uint8Array; mediaType: 'image/jpeg'; name?: string }) => Promise<ImageAttachmentRef>
  readEvidence?: (sessionId: string, evidence: BrowserEvidence) => Promise<{ mediaType: 'image/jpeg'; data: string }>
  agentLive?: (sessionId: string) => boolean
}

export class AnnotationSendStore {
  #pending = new Map<string, StagedAnnotationBatch[]>()
  #byMessage = new Map<string, StagedAnnotationBatch>()
  #now: () => number
  #ttlMs: number

  constructor(opts: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = opts.now ?? Date.now
    this.#ttlMs = opts.ttlMs ?? STAGE_TTL_MS
  }

  stage(batch: Omit<StagedAnnotationBatch, 'expiresAt'>): StagedAnnotationBatch {
    this.#prune()
    const next: StagedAnnotationBatch = { ...batch, expiresAt: this.#now() + this.#ttlMs }
    const queue = this.#pending.get(batch.sessionId) ?? []
    queue.push(next)
    this.#pending.set(batch.sessionId, queue)
    return next
  }

  unstage(sessionId: string): void {
    this.#pending.delete(sessionId)
  }

  /** Replace the unbound queue with one batch (or clear it). Immediate-stage uses this. */
  replacePending(sessionId: string, batch: Omit<StagedAnnotationBatch, 'expiresAt'> | null): StagedAnnotationBatch | undefined {
    this.#pending.delete(sessionId)
    if (batch === null) return undefined
    return this.stage(batch)
  }

  bindInserted(sessionId: string, message: { id: string; source: unknown }): void {
    this.#prune()
    if (!isUserSource(message.source)) return
    const queue = this.#pending.get(sessionId)
    if (queue === undefined || queue.length === 0) return
    const batch = queue.shift()
    if (batch === undefined) return
    if (queue.length === 0) this.#pending.delete(sessionId)
    this.#byMessage.set(message.id, batch)
  }

  takeForMessage(messageId: string): StagedAnnotationBatch | undefined {
    this.#prune()
    const batch = this.#byMessage.get(messageId)
    if (batch === undefined) return undefined
    this.#byMessage.delete(messageId)
    return batch
  }

  #prune(): void {
    const now = this.#now()
    for (const [id, queue] of this.#pending) {
      const kept = queue.filter((batch) => batch.expiresAt >= now)
      if (kept.length === 0) this.#pending.delete(id)
      else this.#pending.set(id, kept)
    }
  }
}

export function isUserSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  return (source as { kind?: unknown }).kind === 'user'
}

export function snippetsFor(
  attachments: readonly Annotation[],
  read?: (path: string) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (read === undefined) return out
  for (const item of attachments) {
    if (item.path === undefined) continue
    const key = item.line === undefined ? item.path : item.path + ':' + item.line
    if (out[key] !== undefined) continue
    const text = read(item.path)
    if (text === undefined) continue
    out[key] = fileSnippet(text, item.line)
  }
  return out
}

export function enrichUserMessage(message: EnrichableMessage, batch: StagedAnnotationBatch): EnrichableMessage {
  const existingImages = message.content.filter((block): block is ImageBlock => block.type === 'image')
  if (existingImages.length + batch.images.length > MAX_ANNOTATION_IMAGES) {
    throw new Error('A prompt can contain at most 20 images')
  }
  const evidence: UserContentBlock[] = []
  if (batch.evidenceText.length > 0) evidence.push({ type: 'text', text: batch.evidenceText })
  for (const image of batch.images) evidence.push({ type: 'image', attachment: image.attachment })
  const source = typeof message.source === 'object' && message.source !== null
    ? { ...(message.source as Record<string, unknown>), annotations: batch.marks }
    : { kind: 'user', annotations: batch.marks }
  return {
    ...message,
    content: [...message.content, ...evidence],
    source,
  }
}

export function applyAnnotationEnrichment(
  messages: readonly EnrichableMessage[],
  store: AnnotationSendStore,
): EnrichableMessage[] {
  return messages.map((message) => {
    const batch = store.takeForMessage(message.id)
    if (batch === undefined) return message
    return enrichUserMessage(message, batch)
  })
}

export async function buildStagedBatch(
  sessionId: string,
  attachments: readonly Annotation[],
  ports: AnnotationSendPorts,
): Promise<Omit<StagedAnnotationBatch, 'expiresAt'>> {
  if (ports.agentLive !== undefined && !ports.agentLive(sessionId)) {
    throw new Error('主会话 Agent is not live')
  }
  if (attachments.length === 0) throw new Error('No 批注 to stage')
  const images: Array<{ evidenceId: string; attachment: ImageAttachmentRef }> = []
  for (const item of attachments) {
    if (item.source !== 'browser' || item.evidence === undefined) continue
    if (ports.readEvidence === undefined || ports.saveImage === undefined) continue
    const jpeg = await ports.readEvidence(sessionId, item.evidence)
    const bytes = Buffer.from(jpeg.data, 'base64')
    const attachment = await ports.saveImage({
      data: bytes,
      mediaType: 'image/jpeg',
      name: 'browser-' + item.evidence.id + '.jpg',
    })
    images.push({ evidenceId: item.evidence.id, attachment })
  }
  if (images.length > MAX_ANNOTATION_IMAGES) throw new Error('A prompt can contain at most 20 images')
  return {
    sessionId,
    attachments: attachments.map((item) => ({ ...item })),
    marks: attachments.map(toMarkView),
    images,
    evidenceText: formatEvidenceSend(attachments, snippetsFor(attachments, ports.readFile)),
  }
}

export function decodeAnnotationList(value: unknown): Annotation[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: Annotation[] = []
  for (const item of value) {
    const decoded = decodeAnnotation(item)
    if (decoded === undefined) return undefined
    out.push(decoded)
  }
  return out
}

function decodeAnnotation(value: unknown): Annotation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const rec = value as Record<string, unknown>
  if (typeof rec.id !== 'string' || rec.id.length === 0) return undefined
  const evidence = decodeEvidence(rec.evidence)
  if (rec.evidence !== undefined && evidence === undefined) return undefined
  return hydrateAnnotation({
    id: rec.id,
    ...typeof rec.text === 'string' ? { text: rec.text } : {},
    ...typeof rec.from === 'string' ? { from: rec.from } : {},
    ...rec.source === 'files' || rec.source === 'browser' || rec.source === 'review' ? { source: rec.source } : {},
    ...typeof rec.selector === 'string' ? { selector: rec.selector } : {},
    ...typeof rec.path === 'string' ? { path: rec.path } : {},
    ...typeof rec.line === 'number' ? { line: rec.line } : {},
    ...typeof rec.url === 'string' ? { url: rec.url } : {},
    ...evidence === undefined ? {} : { evidence },
  })
}

function decodeEvidence(value: unknown): BrowserEvidence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const rec = value as Record<string, unknown>
  if (
    typeof rec.id !== 'string'
    || typeof rec.captureId !== 'string'
    || typeof rec.documentId !== 'string'
    || !Number.isSafeInteger(rec.layoutRevision) || (rec.layoutRevision as number) <= 0
    || !Number.isSafeInteger(rec.mediaGeneration) || (rec.mediaGeneration as number) <= 0
    || typeof rec.ref !== 'string'
    || rec.mediaType !== 'image/jpeg'
    || typeof rec.width !== 'number'
    || typeof rec.height !== 'number'
  ) return undefined
  return {
    id: rec.id,
    captureId: rec.captureId,
    documentId: rec.documentId,
    layoutRevision: rec.layoutRevision as number,
    mediaGeneration: rec.mediaGeneration as number,
    ref: rec.ref,
    mediaType: 'image/jpeg',
    width: rec.width,
    height: rec.height,
  }
}

export type AnnotationSendHost = {
  on(event: string, listener: (...args: never[]) => unknown): () => void
}

export function installAnnotationSend(ctx: AnnotationSendHost, store: AnnotationSendStore): () => void {
  const offInsert = ctx.on('agent/inbox/inserted' as never, ((payload: { agent: { id: string }; message: { id: string; source: unknown } }) => {
    store.bindInserted(String(payload.agent.id), payload.message)
  }) as never)
  const offPre = ctx.on('agent/pre-step' as never, (async (_payload: unknown, next: () => Promise<{ kind: string; messages?: EnrichableMessage[] }>) => {
    const decision = await next()
    if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    return { ...decision, messages: applyAnnotationEnrichment(decision.messages, store) }
  }) as never)
  return () => {
    offInsert()
    offPre()
  }
}
