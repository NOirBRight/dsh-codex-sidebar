/** Build and label stacked 批注 without dumping page innerText. */

import type { Annotation, AnnotationRect, AnnotationTextRange, BrowserEvidence } from './session.ts'

export function noteBody(draft: string): string {
  return draft.trim()
}

export function parsePathLine(mark: string): { path: string; line?: number } {
  const i = mark.lastIndexOf(':')
  if (i <= 0) return { path: mark }
  const raw = mark.slice(i + 1)
  if (!/^\d+$/.test(raw)) return { path: mark }
  const line = Number(raw)
  if (line < 1) return { path: mark }
  return { path: mark.slice(0, i), line }
}

export function fileCaption(mark: string): string {
  const { path, line } = parsePathLine(mark)
  const name = path.split('/').pop() ?? path
  return line === undefined ? name : `${name}:${line}`
}

export function hydrateAnnotation(item: {
  id: string
  text?: string
  from?: string
  source?: Annotation['source']
  selector?: string
  path?: string
  line?: number
  rect?: AnnotationRect
  selection?: AnnotationTextRange
  url?: string
  evidence?: BrowserEvidence
}): Annotation {
  const source = item.source
    ?? (item.id.startsWith('b') ? 'browser' : item.id.startsWith('r') ? 'review' : 'files')
  return { ...item, source, text: item.text ?? '', from: item.from ?? '' }
}

export function fromFileMark(
  id: string,
  draft: string,
  mark: string,
  rect?: AnnotationRect,
  selection?: AnnotationTextRange,
): Annotation {
  const { path, line } = parsePathLine(mark)
  return {
    id,
    text: noteBody(draft),
    from: fileCaption(mark),
    source: 'files',
    selector: mark,
    path,
    ...line === undefined ? {} : { line },
    ...rect === undefined ? {} : { rect },
    ...selection === undefined ? {} : { selection },
  }
}

export function fromReviewMark(id: string, draft: string, mark: string): Annotation {
  const { path, line } = parsePathLine(mark)
  return {
    id,
    text: noteBody(draft),
    from: fileCaption(mark),
    source: 'review',
    selector: mark,
    path,
    ...line === undefined ? {} : { line },
  }
}

export function fromBrowserPending(
  id: string,
  draft: string,
  pending: {
    pendingMark: string
    pendingSelector: string | null
    pendingRect: AnnotationRect | null
    url: string
    evidence?: BrowserEvidence
  },
): Annotation {
  const selector = pending.pendingSelector
  const rect = pending.pendingRect
  return {
    id,
    text: noteBody(draft),
    from: pending.pendingMark,
    source: 'browser',
    url: pending.url,
    ...pending.evidence === undefined ? {} : { evidence: pending.evidence },
    ...selector === null || selector.length === 0 ? {} : { selector },
    ...rect === null ? {} : { rect },
  }
}

export type AnnotationMarkView = {
  id: string
  from: string
  source: Annotation['source']
  selector?: string
  path?: string
  line?: number
  url?: string
  rect?: AnnotationRect
  selection?: AnnotationTextRange
  evidenceId?: string
}

export const SNIPPET_RADIUS = 10
export const SNIPPET_MAX_CHARS = 2000

export function toMarkView(item: Annotation): AnnotationMarkView {
  return {
    id: item.id,
    from: item.from,
    source: item.source,
    ...item.selector === undefined ? {} : { selector: item.selector },
    ...item.path === undefined ? {} : { path: item.path },
    ...item.line === undefined ? {} : { line: item.line },
    ...item.url === undefined ? {} : { url: item.url },
    ...item.rect === undefined ? {} : { rect: item.rect },
    ...item.selection === undefined ? {} : { selection: item.selection },
    ...item.evidence === undefined ? {} : { evidenceId: item.evidence.id },
  }
}

export function visibleAnnotations(snapshot: {
  attachments: readonly Annotation[]
  deliveredMarks?: readonly Annotation[]
}): Annotation[] {
  return [...(snapshot.deliveredMarks ?? []), ...snapshot.attachments]
}

export function annotationMarksFromSource(source: unknown): AnnotationMarkView[] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const marks = (source as { annotations?: unknown }).annotations
  if (!Array.isArray(marks) || marks.length === 0) return undefined
  const out: AnnotationMarkView[] = []
  for (const item of marks) {
    const mark = decodeMarkView(item)
    if (mark !== undefined) out.push(mark)
  }
  return out.length === 0 ? undefined : out
}

export function decodeMarkView(value: unknown): AnnotationMarkView | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const rec = value as Record<string, unknown>
  if (typeof rec.id !== 'string' || typeof rec.from !== 'string') return undefined
  if (rec.source !== 'files' && rec.source !== 'browser' && rec.source !== 'review') return undefined
  return {
    id: rec.id,
    from: rec.from,
    source: rec.source,
    ...typeof rec.selector === 'string' ? { selector: rec.selector } : {},
    ...typeof rec.path === 'string' ? { path: rec.path } : {},
    ...typeof rec.line === 'number' && rec.line >= 1 ? { line: rec.line } : {},
    ...typeof rec.url === 'string' ? { url: rec.url } : {},
    ...decodeRect(rec.rect),
    ...decodeSelection(rec.selection),
    ...typeof rec.evidenceId === 'string' ? { evidenceId: rec.evidenceId } : {},
  }
}

function decodeRect(value: unknown): { rect: AnnotationRect } | Record<string, never> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const rec = value as Record<string, unknown>
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number' || typeof rec.w !== 'number' || typeof rec.h !== 'number') return {}
  return { rect: { x: rec.x, y: rec.y, w: rec.w, h: rec.h } }
}

function decodeSelection(value: unknown): { selection: AnnotationTextRange } | Record<string, never> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const rec = value as Record<string, unknown>
  if (typeof rec.start !== 'number' || typeof rec.end !== 'number') return {}
  return { selection: { start: rec.start, end: rec.end } }
}

export function fileSnippet(
  source: string,
  line?: number,
  radius = SNIPPET_RADIUS,
  maxChars = SNIPPET_MAX_CHARS,
): string {
  const rows = source.split('\n')
  if (line === undefined || line < 1) return clipSnippet(source, maxChars)
  const start = Math.max(0, line - 1 - radius)
  const end = Math.min(rows.length, line + radius)
  const numbered = rows.slice(start, end).map((text, index) => (start + index + 1) + '|' + text)
  return clipSnippet(numbered.join('\n'), maxChars)
}

function clipSnippet(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, Math.max(0, maxChars - 1)) + '…'
}
