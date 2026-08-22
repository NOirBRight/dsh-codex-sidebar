import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSerialPull } from '../src/client/serial-pull.ts'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('startSerialPull', () => {
  it('keeps at most one pull in flight', async () => {
    vi.useFakeTimers()
    const first = deferred<{ seq: number; chunk: string } | undefined>()
    let pulls = 0
    const applied: Array<{ seq: number; chunk: string }> = []
    const stop = startSerialPull({
      intervalMs: 80,
      pull: () => {
        pulls += 1
        return first.promise
      },
      onResult: (pulled) => { applied.push(pulled) },
    })
    await vi.advanceTimersByTimeAsync(80)
    await vi.advanceTimersByTimeAsync(80)
    expect(pulls).toBe(1)
    first.resolve({ seq: 2, chunk: 'ab' })
    await first.promise
    await Promise.resolve()
    expect(applied).toEqual([{ seq: 2, chunk: 'ab' }])
    await vi.advanceTimersByTimeAsync(80)
    expect(pulls).toBe(2)
    stop()
  })

  it('ignores results after stop', async () => {
    vi.useFakeTimers()
    const first = deferred<{ seq: number; chunk: string } | undefined>()
    const applied: Array<{ seq: number; chunk: string }> = []
    const stop = startSerialPull({
      intervalMs: 80,
      pull: () => first.promise,
      onResult: (pulled) => { applied.push(pulled) },
    })
    await vi.advanceTimersByTimeAsync(80)
    stop()
    first.resolve({ seq: 4, chunk: 'late' })
    await first.promise
    await Promise.resolve()
    expect(applied).toEqual([])
  })

  it('resumes after a rejected pull', async () => {
    vi.useFakeTimers()
    let pulls = 0
    const stop = startSerialPull({
      intervalMs: 80,
      pull: async () => {
        pulls += 1
        if (pulls === 1) throw new Error('rpc down')
        return { seq: 1, chunk: 'ok' }
      },
      onResult() {},
    })
    await vi.advanceTimersByTimeAsync(80)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(80)
    expect(pulls).toBe(2)
    stop()
  })
})
