import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { overlayHandleVisible, overlayToggleVisible, seamOffsetPx } from '../src/client/chrome.ts'

describe('侧栏开关 placement', () => {
  it('keeps the overlay 侧栏开关 mounted whenever a 主会话 is open', () => {
    expect(overlayToggleVisible('sess-a')).toBe(true)
    expect(overlayToggleVisible(undefined)).toBe(false)
  })

  it('paints the overlay resize handle only while the 侧栏 is open', () => {
    expect(overlayHandleVisible(false)).toBe(true)
    expect(overlayHandleVisible(true)).toBe(false)
    expect(overlayHandleVisible(undefined)).toBe(false)
  })

  it('pins the handle to the details-column seam, not a CSS-var guess', () => {
    expect(seamOffsetPx(0, 840)).toBe(840)
    expect(seamOffsetPx(12.4, 852.6)).toBe(840)
    const drawer = readFileSync(new URL('../src/client/NarrowDrawer.tsx', import.meta.url), 'utf8')
    const sidebar = readFileSync(new URL('../src/client/Sidebar.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../src/client/css.ts', import.meta.url), 'utf8')
    const index = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(drawer).toContain('pinHandleToSeam')
    expect(drawer).toContain('overlayToggleVisible')
    expect(drawer).toContain('clearDetailsTrackStyle')
    expect(sidebar).not.toContain('SidebarToggleButton')
    expect(index).not.toContain('conversation.session.header.utilities')
    expect(css).not.toContain('left: calc(100% - var(--dcs-details-track, 0px))')
    expect(css).toContain('.dcs-overlay')
    expect(css).toContain('[class$="_frame"][data-dcs-pin]')
    expect(css).not.toContain('[class$="_frame"]:has([data-shell-overlay])')
    expect(drawer).toContain("setAttribute('data-dcs-pin'")
  })
})
