/** One transcript MutationObserver for tool stats, 批注 chips, and path links. */

import { pathFromClick } from './path-links.ts'

const OBSERVE: MutationObserverInit = { childList: true, subtree: true }
const IGNORE = '.dcs-root, .dcs-col, [data-shell-overlay], [data-side="details"], [data-side="sidebar"]'
export const TRANSCRIPT_ROW = '[data-chat-flow-kind], [data-tool]'
export const TRANSCRIPT_HOST = '[data-chat-flow], [data-side="center"]'
export const TRANSCRIPT_PAINT_MIN_MS = 200
export const MAX_INCREMENTAL_ROOTS = 20

export type TranscriptDecoratorPaints = {
  paintStats: (root?: ParentNode) => void
  paintChips: (root?: ParentNode) => void
  paintPaths: (root?: ParentNode) => void
  openPath: (path: string) => void
}

export type TranscriptPaintData = {
  stats?: boolean
  chips?: boolean
}

export type TranscriptDecorators = {
  paintData: (opts?: TranscriptPaintData) => void
  stop: () => void
}

export function ignoredTranscriptTarget(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null
  if (el === null) return false
  return el.closest(IGNORE) !== null
}

export function transcriptMutationIsIgnored(record: MutationRecord): boolean {
  return ignoredTranscriptTarget(record.target)
}

export function transcriptRowOf(node: Node | null): Element | null {
  if (ignoredTranscriptTarget(node)) return null
  const el = node instanceof Element ? node : node?.parentElement ?? null
  if (!(el instanceof Element) || typeof el.closest !== 'function') return null
  const row = el.closest(TRANSCRIPT_ROW)
  return row instanceof Element && !ignoredTranscriptTarget(row) ? row : null
}

export function mutationPaintTarget(node: Node | null): Element | null {
  return transcriptRowOf(node)
}

export function collectAddedTranscriptRoots(record: MutationRecord): Element[] {
  if (transcriptMutationIsIgnored(record)) return []
  const roots: Element[] = []
  const seen = new Set<Element>()
  const add = (el: Element | null): void => {
    if (el === null || seen.has(el)) return
    seen.add(el)
    roots.push(el)
  }
  for (const node of record.addedNodes) {
    if (!(node instanceof Element)) {
      add(transcriptRowOf(node))
      continue
    }
    const row = transcriptRowOf(node)
    if (row !== null) {
      add(row)
      continue
    }
    if (typeof node.querySelectorAll !== 'function') continue
    for (const hit of node.querySelectorAll(TRANSCRIPT_ROW)) {
      if (hit instanceof Element) add(transcriptRowOf(hit) ?? hit)
    }
  }
  if (record.addedNodes.length === 0) add(transcriptRowOf(record.target))
  return roots
}

export function transcriptPaintHosts(doc: Document = document): ParentNode[] {
  if (typeof doc.querySelectorAll !== 'function') return [doc]
  const hosts = doc.querySelectorAll(TRANSCRIPT_HOST)
  return hosts.length > 0 ? [...hosts] : [doc]
}

export function createPendingThrottle(paint: () => void, ms: number): { schedule: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule(): void {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        paint()
      }, ms)
    },
    cancel(): void {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}

export function shouldRebindSession(
  boundId: string | undefined,
  boundStore: unknown,
  nextId: string | undefined,
  nextStore: unknown,
): boolean {
  return boundId !== nextId || boundStore !== nextStore
}

export function installTranscriptDecorators(paints: TranscriptDecoratorPaints): TranscriptDecorators {
  if (typeof document === 'undefined' || document.documentElement === null) {
    return { paintData() {}, stop() {} }
  }

  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPaint = 0
  let fullScan = false
  const pendingRoots = new Set<Element>()
  let observer: MutationObserver

  const isolate = (paint: () => void): void => {
    try {
      paint()
    } catch (err) {
      console.error('[dsh-codex-sidebar] transcript decorator failed', err)
    }
  }

  const run = (pass: () => void): void => {
    observer.disconnect()
    try {
      pass()
    } finally {
      observer.observe(document.documentElement, OBSERVE)
    }
  }

  const takeRoots = (): ParentNode[] => {
    if (fullScan || pendingRoots.size > MAX_INCREMENTAL_ROOTS) {
      pendingRoots.clear()
      fullScan = false
      return transcriptPaintHosts()
    }
    const roots = [...pendingRoots]
    pendingRoots.clear()
    return roots.length === 0 ? transcriptPaintHosts() : roots
  }

  const paintDom = (): void => {
    lastPaint = Date.now()
    const roots = takeRoots()
    run(() => {
      for (const root of roots) {
        isolate(() => { paints.paintStats(root) })
        isolate(() => { paints.paintChips(root) })
        isolate(() => { paints.paintPaths(root) })
      }
    })
  }

  const paintData = (opts?: TranscriptPaintData): void => {
    const stats = opts?.stats !== false
    const chips = opts?.chips !== false
    if (!stats && !chips) return
    pendingRoots.clear()
    fullScan = false
    lastPaint = Date.now()
    const hosts = transcriptPaintHosts()
    run(() => {
      for (const host of hosts) {
        if (stats) isolate(() => { paints.paintStats(host) })
        if (chips) isolate(() => { paints.paintChips(host) })
      }
    })
  }

  const armFrame = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      paintDom()
    })
  }

  const scheduleDom = (): void => {
    if (frame !== 0 || timer !== undefined) return
    const wait = Math.max(0, TRANSCRIPT_PAINT_MIN_MS - (Date.now() - lastPaint))
    if (wait === 0) {
      armFrame()
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      armFrame()
    }, wait)
  }

  const onClick = (event: Event): void => {
    const path = pathFromClick(event)
    if (path === undefined) return
    event.preventDefault()
    event.stopPropagation()
    paints.openPath(path)
  }

  observer = new MutationObserver((records) => {
    let dirty = false
    for (const record of records) {
      const roots = collectAddedTranscriptRoots(record)
      if (roots.length === 0) continue
      dirty = true
      for (const root of roots) pendingRoots.add(root)
    }
    if (dirty) scheduleDom()
  })
  observer.observe(document.documentElement, OBSERVE)
  document.addEventListener('click', onClick, true)
  fullScan = true
  paintDom()

  return {
    paintData,
    stop(): void {
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (frame === 0) return
      cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
