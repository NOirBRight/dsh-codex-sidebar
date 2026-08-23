/** One transcript MutationObserver for tool stats, 批注 chips, and path links. */

import { pathFromClick } from './path-links.ts'

const OBSERVE: MutationObserverInit = { childList: true, subtree: true }
const IGNORE = '.dcs-root, .dcs-col, [data-shell-overlay], [data-side="details"], [data-side="sidebar"]'
export const TRANSCRIPT_PAINT_MIN_MS = 200
export const MAX_INCREMENTAL_ROOTS = 20

export type TranscriptDecoratorPaints = {
  paintStats: (root?: ParentNode) => void
  paintChips: (root?: ParentNode) => void
  paintPaths: (root?: ParentNode) => void
  openPath: (path: string) => void
}

export type TranscriptDecorators = {
  paintData: () => void
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

export function mutationPaintTarget(node: Node | null): Element | 'full' | null {
  if (ignoredTranscriptTarget(node)) return null
  const el = node instanceof Element ? node : node?.parentElement ?? null
  if (!(el instanceof Element)) return 'full'
  if (typeof document !== 'undefined' && (el === el.ownerDocument?.documentElement || el === document.documentElement)) {
    return 'full'
  }
  return el
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
      return [document]
    }
    const roots = [...pendingRoots]
    pendingRoots.clear()
    return roots.length === 0 ? [document] : roots
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

  const paintData = (): void => {
    pendingRoots.clear()
    fullScan = false
    lastPaint = Date.now()
    run(() => {
      isolate(() => { paints.paintStats() })
      isolate(() => { paints.paintChips() })
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
      const target = mutationPaintTarget(record.target)
      if (target === null) continue
      dirty = true
      if (target === 'full') fullScan = true
      else pendingRoots.add(target)
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
