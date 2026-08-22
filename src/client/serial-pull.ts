/** Serial interval pull: at most one request in flight; ignore results after stop. */

export type SerialPull = {
  seq: number
  chunk: string
}

export function startSerialPull(options: {
  intervalMs: number
  pull: () => Promise<SerialPull | undefined>
  onResult: (pulled: SerialPull) => void
}): () => void {
  let inFlight = false
  let stopped = false
  const tick = (): void => {
    if (stopped || inFlight) return
    inFlight = true
    void options.pull().then((pulled) => {
      if (stopped || pulled === undefined) return
      options.onResult(pulled)
    }).catch(() => {
      /* keep polling after a rejected pull */
    }).finally(() => {
      inFlight = false
    })
  }
  const timer = setInterval(tick, options.intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
