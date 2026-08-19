import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import {
  CLIENT_INJECT,
  DEFAULT_DETAILS_PRIORITY,
  DETAILS_PRIORITY,
  DETAILS_SLOT,
  applyDetailsTrack,
  detailsTrackShouldOpen,
  occupyDetails,
  shadowsDefaultDetails,
} from '../src/details-occupancy.ts'

vi.mock('../src/client/css.ts', () => ({ ensureSidebarStyles() {} }))
vi.mock('../src/client/Sidebar.tsx', () => ({ SidebarPanel: function SidebarPanel() { return null } }))
vi.mock('../src/client/Toggle.tsx', () => ({ SidebarToggle: function SidebarToggle() { return null } }))
vi.mock('../src/client/AttachmentChips.tsx', () => ({ AttachmentChips: function AttachmentChips() { return null } }))
vi.mock('../src/client/NarrowDrawer.tsx', () => ({ NarrowDrawer: function NarrowDrawer() { return null } }))
vi.mock('../src/client/tool-stats.ts', () => ({ installToolStats: () => ({ paint() {}, stop() {} }) }))
vi.mock('../src/client/controller.ts', () => ({
  SidebarController: class SidebarController {
    installPathTakeover() { throw new Error('workspaces missing') }
    subscribe() { return () => {} }
    snap() { return undefined }
  }
}))

function fakeCtx() {
  const registered: Array<{ name: string; priority: number }> = []
  const injected: string[] = []
  const ctx = {
    locale: { register() {} },
    slots: {
      inject(key: string, callback: () => void) {
        injected.push(key)
        callback()
      },
      register(options: { name: string; priority: number }) {
        registered.push({ name: options.name, priority: options.priority })
      },
    },
    effect() { return () => {} },
    sessions: {
      list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
      binding: () => undefined,
    },
    layout: { openDetails() {}, closeDetails() {} },
    get: () => ({ rpc: {} }),
  }
  return { ctx, registered, injected }
}

describe('details occupancy', () => {
  it('injects both the workspaces service and its boot provider', () => {
    expect(CLIENT_INJECT).toEqual(inject)
    expect(CLIENT_INJECT).toContain('workspaces')
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
    }
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
  })

  it('shadows the shipped DetailsPanel (priority 0)', () => {
    expect(shadowsDefaultDetails(DETAILS_PRIORITY)).toBe(true)
    expect(shadowsDefaultDetails(DEFAULT_DETAILS_PRIORITY)).toBe(false)
  })

  it('opens the AppFrame details track only when the 侧栏 is expanded', () => {
    expect(detailsTrackShouldOpen(true)).toBe(false)
    expect(detailsTrackShouldOpen(false)).toBe(true)
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    applyDetailsTrack(layout, true)
    expect(layout.closeDetails).toHaveBeenCalledOnce()
    expect(layout.openDetails).not.toHaveBeenCalled()
    applyDetailsTrack(layout, false)
    expect(layout.openDetails).toHaveBeenCalledOnce()
  })

  it('holds the AppFrame track while the session snapshot is loading', () => {
    const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
    applyDetailsTrack(layout, undefined)
    expect(layout.openDetails).not.toHaveBeenCalled()
    expect(layout.closeDetails).not.toHaveBeenCalled()
  })

  it('occupyDetails registers the details slot at the shadowing priority', () => {
    const { ctx, registered, injected } = fakeCtx()
    occupyDetails(ctx.slots, () => ({}), {}, 'codex-sidebar')
    expect(injected).toEqual([DETAILS_SLOT])
    expect(registered).toEqual([{ name: DETAILS_SLOT, priority: DETAILS_PRIORITY }])
  })

  it('apply still occupies details when path takeover throws', () => {
    const { ctx, registered, injected } = fakeCtx()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => apply(ctx as never)).not.toThrow()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
    expect(injected[0]).toBe(DETAILS_SLOT)
    expect(registered.some((row) => row.name === DETAILS_SLOT && row.priority === DETAILS_PRIORITY)).toBe(true)
  })
})
