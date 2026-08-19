/** Turn stacked 批注 into human-facing prompt text and model-facing evidence. */

import type { Annotation } from './session.ts'

export function formatHumanSend(text: string, attachments: readonly Annotation[]): string {
  const body = text.trim()
  const notes = attachments.map((item) => item.text.trim()).filter((note) => note.length > 0)
  if (body.length > 0 && !attachments.some((item) => item.text.trim() === body)) return body
  if (notes.length === 1) return notes[0] ?? ''
  if (notes.length > 1) return notes.map((note, index) => (index + 1) + '. ' + note).join('\n')
  if (attachments.length === 0) return body
  return attachments.map((item, index) => '批注 ' + (index + 1) + ' · ' + item.from).join('\n')
}

export const formatSend = formatHumanSend

export function formatEvidenceSend(
  attachments: readonly Annotation[],
  snippets: Readonly<Record<string, string>> = {},
): string {
  return attachments.map((item, index) => formatEvidenceMark(item, index + 1, snippets)).filter((row) => row.length > 0).join('\n\n')
}

function formatEvidenceMark(item: Annotation, n: number, snippets: Readonly<Record<string, string>>): string {
  const lines = ['批注 ' + n + ' · ' + item.from]
  if (item.selector !== undefined && item.selector.length > 0 && item.selector !== item.from) {
    lines.push('`' + item.selector + '`')
  }
  if (item.url !== undefined && item.url.length > 0) lines.push(item.url)
  const snippet = snippetFor(item, snippets)
  if (snippet !== undefined && snippet.length > 0) {
    lines.push('```')
    lines.push(snippet)
    lines.push('```')
  }
  return lines.join('\n')
}

function snippetFor(item: Annotation, snippets: Readonly<Record<string, string>>): string | undefined {
  if (item.path === undefined) return undefined
  if (item.line !== undefined) {
    const keyed = snippets[item.path + ':' + item.line]
    if (keyed !== undefined) return keyed
  }
  return snippets[item.path]
}

export function formatDelivery(text: string, sourceTab: string, sourceSession: string): string {
  const label = '[投递 · Side Chat ' + sourceTab + ' · 主会话 ' + sourceSession + ']'
  const body = text.trim()
  if (body.length === 0) return label
  return label + '\n' + body
}
