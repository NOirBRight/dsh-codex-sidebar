import { describe, expect, it } from 'vitest'
import { closedDetailsGrid, detailsTrackPx, sidebarTrackFromGrid } from '../src/client/host-frame.ts'

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
})
