/** Serial interval pull: at most one request in flight; ignore results after stop. */

export type SerialPull = {
  seq: number
  chunk: string
}

export const SERIAL_PULL_MAX_INTERVAL_MS = 500

export function startSerialPull(options: {
  intervalMs: number
  maxIntervalMs?: number
  pull: () => Promise<SerialPull | undefined>
  onResult: (pulled: SerialPull) => void
}): () => void {
  const fast = options.intervalMs
  const slow = options.maxIntervalMs ?? SERIAL_PULL_MAX_INTERVAL_MS
  let inFlight = false
  let stopped = false
  let hidden = pageIsHidden()
  let delay = fast
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (ms: number): void => {
    if (stopped || hidden || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      tick()
    }, ms)
  }

  const tick = (): void => {
    if (stopped || hidden || inFlight) return
    inFlight = true
    void options.pull().then((pulled) => {
      if (stopped) return
      if (pulled !== undefined) {
        options.onResult(pulled)
        delay = pulled.chunk.length > 0 ? fast : nextDelay(delay, fast, slow)
      } else {
        delay = nextDelay(delay, fast, slow)
      }
    }).catch(() => {
      delay = fast
    }).finally(() => {
      inFlight = false
      if (!stopped && !hidden) arm(delay)
    })
  }

  const onVisibility = (): void => {
    hidden = pageIsHidden()
    if (hidden) {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      return
    }
    delay = fast
    if (!inFlight) tick()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  arm(fast)

  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

function pageIsHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true
}

function nextDelay(current: number, fast: number, slow: number): number {
  return Math.min(slow, Math.max(fast, current) * 2)
}
