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
  openPath: (path: string) => boolean | Promise<boolean> | undefined
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

function disposeReverse(disposers: readonly (() => void)[]): void {
  const failures: unknown[] = []
  for (let index = disposers.length - 1; index >= 0; index--) {
    const dispose = disposers[index]
    if (dispose === undefined) continue
    try {
      dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'transcript decorator teardown failed')
}

export function installTranscriptDecorators(paints: TranscriptDecoratorPaints): TranscriptDecorators {
  if (typeof document === 'undefined' || document.documentElement === null) {
    return { paintData() {}, stop() {} }
  }
  const observerConstructor = typeof MutationObserver === 'function' ? MutationObserver : undefined
  const requestFrame = globalThis.requestAnimationFrame
  const cancelFrame = globalThis.cancelAnimationFrame
  if (observerConstructor === undefined
    || typeof observerConstructor.prototype.observe !== 'function'
    || typeof observerConstructor.prototype.disconnect !== 'function'
    || typeof requestFrame !== 'function'
    || typeof cancelFrame !== 'function'
    || typeof document.addEventListener !== 'function'
    || typeof document.removeEventListener !== 'function') {
    return { paintData() {}, stop() {} }
  }

  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastPaint = 0
  let stopped = false
  let hidden = document.hidden === true
  const pendingRoots = new Set<Element>()
  let paintHosts: ParentNode[] = []
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
      if (!stopped) observer.observe(document.documentElement, OBSERVE)
    }
  }

  const takeRoots = (): Element[] => {
    const roots: Element[] = []
    for (const root of pendingRoots) {
      roots.push(root)
      pendingRoots.delete(root)
      if (roots.length >= MAX_INCREMENTAL_ROOTS) break
    }
    return roots
  }

  const syncHidden = (): boolean => {
    hidden = document.hidden === true
    return hidden
  }

  const scheduleDom = (): void => {
    if (stopped || syncHidden() || pendingRoots.size === 0 || frame !== 0 || timer !== undefined) return
    const wait = Math.max(0, TRANSCRIPT_PAINT_MIN_MS - (Date.now() - lastPaint))
    if (wait === 0) {
      armFrame()
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      if (!stopped && !syncHidden()) armFrame()
    }, wait)
  }

  const paintDom = (): void => {
    if (stopped || syncHidden()) return
    const roots = takeRoots()
    if (roots.length === 0) return
    lastPaint = Date.now()
    run(() => {
      for (const root of roots) {
        isolate(() => { paints.paintStats(root) })
        isolate(() => { paints.paintChips(root) })
        isolate(() => { paints.paintPaths(root) })
      }
    })
    scheduleDom()
  }

  const paintInitial = (): void => {
    lastPaint = Date.now()
    paintHosts = transcriptPaintHosts()
    const hosts = paintHosts
    run(() => {
      for (const host of hosts) {
        isolate(() => { paints.paintStats(host) })
        isolate(() => { paints.paintChips(host) })
        isolate(() => { paints.paintPaths(host) })
      }
    })
  }

  const paintData = (opts?: TranscriptPaintData): void => {
    if (stopped) return
    const stats = opts?.stats !== false
    const chips = opts?.chips !== false
    if (!stats && !chips) return
    pendingRoots.clear()
    lastPaint = Date.now()
    const hosts = paintHosts
    run(() => {
      for (const host of hosts) {
        if (stats) isolate(() => { paints.paintStats(host) })
        if (chips) isolate(() => { paints.paintChips(host) })
      }
    })
  }

  function armFrame(): void {
    if (stopped || syncHidden() || pendingRoots.size === 0 || frame !== 0) return
    frame = requestFrame(() => {
      frame = 0
      paintDom()
    })
  }

  const cancelScheduled = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (frame !== 0) {
      cancelFrame(frame)
      frame = 0
    }
  }

  const onVisibility = (): void => {
    hidden = document.hidden === true
    if (hidden) {
      cancelScheduled()
      return
    }
    scheduleDom()
  }

  const onClick = (event: Event): void => {
    const path = pathFromClick(event)
    if (path === undefined) return
    const result = paints.openPath(path)
    const takeOver = (opened: boolean | undefined): void => {
      if (opened !== true) return
      event.preventDefault()
      event.stopPropagation()
    }
    if (result === undefined || typeof result === 'boolean') {
      takeOver(result)
      return
    }
    void result.then(takeOver)
  }

  const setupDisposers: Array<() => void> = []
  try {
    observer = new observerConstructor((records) => {
      if (stopped) return
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
    setupDisposers.push(() => { observer.disconnect() })
    document.addEventListener('click', onClick, true)
    setupDisposers.push(() => { document.removeEventListener('click', onClick, true) })
    document.addEventListener('visibilitychange', onVisibility)
    setupDisposers.push(() => { document.removeEventListener('visibilitychange', onVisibility) })
    setupDisposers.push(cancelScheduled)
    paintInitial()
  } catch (error) {
    stopped = true
    pendingRoots.clear()
    try {
      disposeReverse(setupDisposers)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'transcript decorator setup failed and rollback failed')
    }
    throw error
  }

  let disposed = false
  return {
    paintData,
    stop(): void {
      if (disposed) return
      disposed = true
      stopped = true
      pendingRoots.clear()
      disposeReverse(setupDisposers)
      setupDisposers.length = 0
    },
  }
}
