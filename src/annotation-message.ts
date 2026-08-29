/** Split a logged user message into human text vs hidden evidence. */

/** Invisible draft content used only to make an annotation-only Alpha composer submit-ready. */
export const ANNOTATION_DRAFT_SENTINEL = '\u200b'

/** Remove the trailing submit sentinel only from an annotation-only blank draft. */
export function stripAnnotationDraftSentinel(draft: string): string {
  if (!draft.endsWith(ANNOTATION_DRAFT_SENTINEL)) return draft
  const withoutSentinel = draft.slice(0, -ANNOTATION_DRAFT_SENTINEL.length)
  return withoutSentinel.trim().length === 0 ? withoutSentinel : draft
}

export type MessageImageRef = { attachmentId: string }

export type UserTextPart = { kind: 'text'; text: string } | { kind: 'ref'; text: string }

export function projectUserText(text: string): UserTextPart[] {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: UserTextPart[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const token = match[2] ?? ''
    const tokenStart = match.index + (match[1]?.length ?? 0)
    if (tokenStart > cursor) parts.push({ kind: 'text', text: text.slice(cursor, tokenStart) })
    parts.push({ kind: 'ref', text: token })
    cursor = tokenStart + token.length
  }
  if (parts.length === 0) return [{ kind: 'text', text }]
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}

export function firstTextBlock(content: readonly unknown[]): string {
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const rec = block as { type?: unknown; text?: unknown }
    if (rec.type === 'text' && typeof rec.text === 'string') return rec.text
  }
  return ''
}

export function contentImages(content: readonly unknown[]): MessageImageRef[] {
  const images: MessageImageRef[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const rec = block as { type?: unknown; attachment?: unknown }
    if (rec.type !== 'image' || typeof rec.attachment !== 'object' || rec.attachment === null) continue
    const attachment = rec.attachment as { attachmentId?: unknown }
    if (typeof attachment.attachmentId !== 'string') continue
    images.push({ attachmentId: attachment.attachmentId })
  }
  return images
}
