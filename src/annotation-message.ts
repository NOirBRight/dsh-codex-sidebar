/** Split a logged user message into human text vs hidden evidence. */

export type MessageImageRef = { attachmentId: string }

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
