import { describe, expect, it, vi } from 'vitest'
import { callerMayDrive, formatDriveTree, type DriveNode } from '../src/browser-drive.ts'
import { BROWSER_DRIVE_TOOLS, type BrowserDriveService } from '../src/host-browser-tools.ts'
import { registerBrowserDriveTools } from '../src/register-browser-tools.ts'

const nodes: DriveNode[] = [
  { ref: '@d1e1', role: 'heading', name: 'Sign in', selector: 'h1' },
  { ref: '@d1e2', role: 'button', name: 'Continue', selector: 'button.submit' },
]

describe('managed Browser drive contract', () => {
  it('formats document-scoped refs and keeps the main-session guard', () => {
    expect(formatDriveTree(nodes, 'Sign in')).toContain('button "Continue" [ref=@d1e2]')
    expect(callerMayDrive(undefined)).toBe(false)
    expect(callerMayDrive({})).toBe(true)
    expect(callerMayDrive({ parentSession: 'root' })).toBe(false)
    expect(callerMayDrive({ origin: 'subagent' })).toBe(false)
  })

  it('registers the same five tool names and disposes every registration', async () => {
    type Registered = {
      name: string
      execute: (args: Record<string, unknown>, exec: { agent?: { session?: { header?: Record<string, unknown> } } }) => Promise<unknown>
    }
    const definitions = new Map<string, Registered>()
    const disposed = vi.fn()
    let guard: ((exec: { name: string; agent?: { session?: { header?: Record<string, unknown> } } }) => string | undefined) | undefined
    const service: BrowserDriveService = {
      tabs: () => ({ ok: true, tabs: [] }),
      open: async () => ({ ok: false, code: 'no-browser', message: 'none' }),
      snapshot: async () => ({ ok: false, code: 'no-browser', message: 'none' }),
      click: async () => ({ ok: false, code: 'no-browser', message: 'none' }),
      fill: async () => ({ ok: false, code: 'no-browser', message: 'none' }),
    }
    const dispose = registerBrowserDriveTools(
      {
        register(definition) {
          const typed = definition as Registered
          definitions.set(typed.name, typed)
          return disposed
        },
        guard(fn) { guard = fn; return disposed },
      },
      service,
      () => ({}) as never,
    )
    expect([...definitions.keys()]).toEqual([...BROWSER_DRIVE_TOOLS])
    expect(guard?.({ name: 'browser_tabs', agent: { session: { header: { origin: 'subagent' } } } })).toContain('主会话')
    dispose()
    expect(disposed).toHaveBeenCalledTimes(6)
  })
})
