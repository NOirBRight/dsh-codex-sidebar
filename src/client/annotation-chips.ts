/** Paint 批注 chips under the official user bubble. Does not replace the node renderer. */

import { annotationMarksFromSource, hydrateAnnotation, type AnnotationMarkView } from '../annotation.ts'
import type { Annotation } from '../session.ts'

const MARK = 'dcs-msg-chips-row'
const painted = new WeakMap<HTMLElement, string>()
const latest = new WeakMap<HTMLButtonElement, { sessionId: string; mark: Annotation }>()

export type AnnotationChipPorts = {
  sessionId: () => string | undefined
  nodeSource: (key: string) => unknown
  reveal: (sessionId: string, mark: Annotation) => void
  label: (n: number, from: string) => string
}

export function sourceForFlowKey(snapshot: unknown, key: string): unknown {
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const chat = (snapshot as { chat?: { nodes?: unknown } }).chat
  const nodes = chat?.nodes
  if (nodes === undefined || nodes === null) return undefined
  const rec = nodes as { get?: (k: string) => { data?: { source?: unknown } } } & Record<string, { data?: { source?: unknown } }>
  const node = typeof rec.get === 'function' ? rec.get(key) : rec[key]
  return node?.data?.source
}

export function decorate(ports: AnnotationChipPorts, root: ParentNode = document): void {
  const sessionId = ports.sessionId()
  const rows = root.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue
    const key = row.getAttribute('data-chat-flow-key') ?? ''
    const existing = row.querySelector(':scope > .' + MARK)
    if (key.length === 0 || sessionId === undefined) {
      existing?.remove()
      painted.delete(row)
      continue
    }
    const marks = annotationMarksFromSource(ports.nodeSource(key))
    if (marks === undefined || marks.length === 0) {
      existing?.remove()
      painted.delete(row)
      continue
    }
    if (sessionId === undefined) continue
    const signature = marksSignature(sessionId, marks)
    const host = existing instanceof HTMLElement ? existing : document.createElement('div')
    host.className = MARK
    if (existing instanceof HTMLElement && painted.get(row) === signature) {
      bindExisting(host, marks, sessionId)
      continue
    }
    host.replaceChildren(...marks.map((mark, index) => chipButton(mark, index, sessionId, ports)))
    painted.set(row, signature)
    if (existing === null) row.append(host)
  }
}

function marksSignature(sessionId: string, marks: readonly AnnotationMarkView[]): string {
  return sessionId + '\0' + marks.map((mark) => [
    mark.id,
    mark.from,
    mark.source,
    mark.selector ?? '',
    mark.path ?? '',
    mark.line === undefined ? '' : String(mark.line),
    mark.url ?? '',
  ].join('\x1f')).join('\x1e')
}

function bindExisting(host: HTMLElement, marks: readonly AnnotationMarkView[], sessionId: string): void {
  for (let i = 0; i < host.children.length; i++) {
    const button = host.children[i]
    const mark = marks[i]
    if (!(button instanceof HTMLButtonElement) || mark === undefined) continue
    latest.set(button, { sessionId, mark: markToAnnotation(mark) })
  }
}

function chipButton(mark: AnnotationMarkView, index: number, sessionId: string, ports: AnnotationChipPorts): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dcs-chip dcs-msg-chip'
  button.setAttribute('aria-label', ports.label(index + 1, mark.from))
  const n = document.createElement('span')
  n.className = 'dcs-chip-n'
  n.textContent = String(index + 1)
  const from = document.createElement('span')
  from.className = 'dcs-chip-from'
  from.textContent = mark.from
  button.append(n, from)
  latest.set(button, { sessionId, mark: markToAnnotation(mark) })
  button.addEventListener('click', () => {
    const current = latest.get(button)
    if (current === undefined) return
    ports.reveal(current.sessionId, current.mark)
  })
  return button
}

function markToAnnotation(mark: AnnotationMarkView): Annotation {
  return hydrateAnnotation({
    id: mark.id,
    from: mark.from,
    source: mark.source,
    ...mark.selector === undefined ? {} : { selector: mark.selector },
    ...mark.path === undefined ? {} : { path: mark.path },
    ...mark.line === undefined ? {} : { line: mark.line },
    ...mark.url === undefined ? {} : { url: mark.url },
    ...mark.rect === undefined ? {} : { rect: mark.rect },
    ...mark.selection === undefined ? {} : { selection: mark.selection },
  })
}
