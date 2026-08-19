/** Paint 批注 chips under the official user bubble. Does not replace the node renderer. */

import { annotationMarksFromSource, hydrateAnnotation, type AnnotationMarkView } from '../annotation.ts'
import type { Annotation } from '../session.ts'

const MARK = 'dcs-msg-chips-row'
const OBSERVE: MutationObserverInit = { childList: true, subtree: true }

export type AnnotationChipPorts = {
  sessionId: () => string | undefined
  nodeSource: (key: string) => unknown
  reveal: (sessionId: string, mark: Annotation) => void
  label: (n: number, from: string) => string
}

export function installAnnotationChips(ports: AnnotationChipPorts): { stop: () => void; paint: () => void } {
  if (typeof document === 'undefined') {
    return { stop() {}, paint() {} }
  }
  let observer: MutationObserver
  const paint = (): void => {
    observer.disconnect()
    try {
      decorate(ports)
    } finally {
      observer.observe(document.documentElement, OBSERVE)
    }
  }
  observer = new MutationObserver(paint)
  observer.observe(document.documentElement, OBSERVE)
  paint()
  return { stop() { observer.disconnect() }, paint }
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

function decorate(ports: AnnotationChipPorts): void {
  const sessionId = ports.sessionId()
  const rows = document.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue
    const key = row.getAttribute('data-chat-flow-key') ?? ''
    const marks = key.length === 0 || sessionId === undefined
      ? undefined
      : annotationMarksFromSource(ports.nodeSource(key))
    const existing = row.querySelector(':scope > .' + MARK)
    if (marks === undefined || marks.length === 0) {
      existing?.remove()
      continue
    }
    const host = existing instanceof HTMLElement ? existing : document.createElement('div')
    host.className = MARK
    host.replaceChildren(...marks.map((mark, index) => chipButton(mark, index, sessionId, ports)))
    if (existing === null) row.append(host)
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
  button.addEventListener('click', () => {
    ports.reveal(sessionId, markToAnnotation(mark))
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
