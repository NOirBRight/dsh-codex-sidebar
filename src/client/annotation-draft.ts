/** Invisible bridge that lets the resident composer submit stacked annotations with no visible draft. */

import { ANNOTATION_DRAFT_SENTINEL, stripAnnotationDraftSentinel } from '../annotation-message.ts'

export { ANNOTATION_DRAFT_SENTINEL, stripAnnotationDraftSentinel }

export function annotationDraftProjection(
  draft: string,
  annotationCount: number,
  imageCount: number,
): string {
  const visible = stripAnnotationDraftSentinel(draft)
  if (annotationCount <= 0 || imageCount > 0 || visible.trim().length > 0) return visible
  return visible + ANNOTATION_DRAFT_SENTINEL
}
