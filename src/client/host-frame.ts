/** Read/write AppFrame grid tracks so the 侧栏 can squeeze the center column. */

export function sidebarTrackFromGrid(gridTemplateColumns: string): string | undefined {
  const match = gridTemplateColumns.trim().match(/^(\d+(?:\.\d+)?px)\b/)
  return match?.[1]
}

export function detailsTrackPx(collapsed: boolean | undefined, width: number): string {
  if (collapsed !== false) return '0px'
  return `${Math.max(0, Math.round(width))}px`
}

export function closedDetailsGrid(sidebarPx: string): string {
  return `${sidebarPx} minmax(0, 1fr) 0px`
}
