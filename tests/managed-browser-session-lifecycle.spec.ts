import { describe, expect, it, vi } from 'vitest'
import { installManagedBrowserSessionLifecycle } from '../src/managed-browser-session-lifecycle.ts'

describe('managed Browser session lifecycle', () => {
  it('releases stream, page, and file state when the owning session is disposed', async () => {
    let disposeSession: ((session: { id: string }) => void) | undefined
    const stop = vi.fn()
    const on = vi.fn((_name, listener: (session: { id: string }) => void, options) => {
      disposeSession = listener
      expect(options).toEqual({ global: true })
      return stop
    })
    const closeStream = vi.fn()
    const closeRuntime = vi.fn(async () => {})
    const filesBySession = new Map([['session-1', {}]])

    const installed = installManagedBrowserSessionLifecycle(
      { on },
      { closeSession: closeStream },
      { closeSession: closeRuntime },
      filesBySession,
    )

    expect(installed).toBe(stop)
    expect(on).toHaveBeenCalledWith('session/disposed', expect.any(Function), { global: true })
    disposeSession?.({ id: 'session-1' })
    await vi.waitFor(() => { expect(closeRuntime).toHaveBeenCalledWith('session-1') })
    expect(closeStream).toHaveBeenCalledWith('session-1')
    expect(filesBySession.has('session-1')).toBe(false)
  })
})
