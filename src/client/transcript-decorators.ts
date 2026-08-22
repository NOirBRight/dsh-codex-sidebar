/** One transcript MutationObserver for tool stats, 批注 chips, and path links. */

import { pathFromClick } from './path-links.ts'

const OBSERVE: MutationObserverInit = { childList: true, subtree: true }
const IGNORE = '.dcs-root, .dcs-col, [data-shell-overlay], [data-side="details"], [data-side="sidebar"]'

export type TranscriptDecoratorPaints = {
  paintStats: () => void
  paintChips: () => void
  paintPaths: () => void
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

  const paintDom = (): void => {
    run(() => {
      isolate(paints.paintStats)
      isolate(paints.paintChips)
      isolate(paints.paintPaths)
    })
  }

  const paintData = (): void => {
    run(() => {
      isolate(paints.paintStats)
      isolate(paints.paintChips)
    })
  }

  const scheduleDom = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      paintDom()
    })
  }

  const onClick = (event: Event): void => {
    const path = pathFromClick(event)
    if (path === undefined) return
    event.preventDefault()
    event.stopPropagation()
    paints.openPath(path)
  }

  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (transcriptMutationIsIgnored(record)) continue
      scheduleDom()
      return
    }
  })
  observer.observe(document.documentElement, OBSERVE)
  document.addEventListener('click', onClick, true)
  paintDom()

  return {
    paintData,
    stop(): void {
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      if (frame === 0) return
      cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
