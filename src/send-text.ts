/** Turn stacked 批注 into 主会话 prompt text. */

import type { Annotation } from './session.ts'

export function formatSend(text: string, attachments: readonly Annotation[]): string {
  const marks = attachments.map((item, index) => formatMark(item, index + 1)).join('\n\n')
  const body = text.trim()
  if (body.length === 0) return marks
  if (marks.length === 0) return body
  if (attachments.some((item) => item.text.trim() === body)) return marks
  return `${body}\n\n${marks}`
}

function formatMark(item: Annotation, n: number): string {
  const title = `批注 ${n} · ${item.from}`
  const locator = item.selector !== undefined
    && item.selector.length > 0
    && item.selector !== item.from
    ? `\n\`${item.selector}\``
    : ''
  const note = item.text.trim()
  if (note.length === 0) return `${title}${locator}`
  return `${title}${locator}\n${note}`
}

export function formatDelivery(text: string, sourceTab: string, sourceSession: string): string {
  const label = `[投递 · Side Chat ${sourceTab} · 主会话 ${sourceSession}]`
  const body = text.trim()
  if (body.length === 0) return label
  return `${label}\n${body}`
}
