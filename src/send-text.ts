/** Turn stacked 批注 into 主会话 prompt text. */

import type { Annotation } from './session.ts'

export function formatSend(text: string, attachments: readonly Annotation[]): string {
  const marks = attachments
    .map((item) => `[批注 ${item.from}]\n${item.text}`)
    .join('\n\n')
  const body = text.trim()
  if (body.length === 0) return marks
  if (marks.length === 0) return body
  return `${body}\n\n${marks}`
}

export function formatDelivery(text: string, sourceTab: string, sourceSession: string): string {
  const label = `[投递 · Side Chat ${sourceTab} · 主会话 ${sourceSession}]`
  const body = text.trim()
  if (body.length === 0) return label
  return `${label}\n${body}`
}
