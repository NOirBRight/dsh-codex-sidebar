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
