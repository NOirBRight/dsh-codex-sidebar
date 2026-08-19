import { describe, expect, it } from 'vitest'
import { clearDetailsTrackStyle, closedDetailsGrid, detailsTrackPx, sidebarTrackFromGrid } from '../src/client/host-frame.ts'

describe('AppFrame details track', () => {
  it('reads the sidebar track from host inline and computed grids', () => {
    expect(sidebarTrackFromGrid('56px minmax(0, 1fr) 360px')).toBe('56px')
    expect(sidebarTrackFromGrid('280px minmax(0, 1fr) 520px')).toBe('280px')
    expect(sidebarTrackFromGrid('56px 890.4px 494px')).toBe('56px')
  })

  it('rebuilds a grid with a zero details track so center fills', () => {
    expect(closedDetailsGrid('56px')).toBe('56px minmax(0, 1fr) 0px')
    expect(closedDetailsGrid('280px')).toBe('280px minmax(0, 1fr) 0px')
  })

  it('opens a details track in px when the 侧栏 is expanded', () => {
    expect(detailsTrackPx(true, 560)).toBe('0px')
    expect(detailsTrackPx(false, 560)).toBe('560px')
    expect(detailsTrackPx(false, 560.4)).toBe('560px')
  })

  it('keeps the details track closed while the session snapshot is loading', () => {
    expect(detailsTrackPx(undefined, 560)).toBe('0px')
  })

  it('clears a leftover 侧栏 track when New Session has no 主会话', () => {
    const calls: string[] = []
    const frame = {
      style: { setProperty(name: string, value: string) { calls.push(name + '=' + value) } },
      removeAttribute(name: string) { calls.push('remove:' + name) },
    }
    clearDetailsTrackStyle(frame)
    expect(calls).toEqual(['--dcs-details-track=0px', 'remove:data-dcs-open'])
  })
})
