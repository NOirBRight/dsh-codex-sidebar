/** Invisible bridge that lets the resident composer submit stacked annotations with no visible draft. */

export const ANNOTATION_DRAFT_SENTINEL = '\u200b'

export function stripAnnotationDraftSentinel(draft: string): string {
  return draft.replaceAll(ANNOTATION_DRAFT_SENTINEL, '')
}

export function annotationDraftProjection(
  draft: string,
  annotationCount: number,
  imageCount: number,
): string {
  const visible = stripAnnotationDraftSentinel(draft)
  if (annotationCount <= 0 || imageCount > 0 || visible.trim().length > 0) return visible
  return visible + ANNOTATION_DRAFT_SENTINEL
}
