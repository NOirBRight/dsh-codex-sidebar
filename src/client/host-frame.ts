/** Read/write AppFrame grid tracks so the 侧栏 can squeeze the center column. */

import { peekDrawerWidth } from './drawer-width.ts'

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

/** Drop a leftover 侧栏 track when New Session has no 主会话. */
export function clearDetailsTrackStyle(frame: {
  style: { setProperty(name: string, value: string): void }
  removeAttribute(name: string): void
}): void {
  frame.style.setProperty('--dcs-details-track', '0px')
  frame.removeAttribute('data-dcs-open')
  frame.removeAttribute('data-dcs-pin')
}

/** Stamp plugin-owned markers on the host frame so CSS never matches CSS-module hashes. */
export function markHostFrame(frame: HTMLElement): void {
  const overlay = frame.querySelector('[data-shell-overlay]')
  const details = overlay?.previousElementSibling
  if (details instanceof HTMLElement) details.setAttribute('data-dcs-details', '')
  const center = details instanceof HTMLElement ? details.previousElementSibling : null
  const header = center instanceof HTMLElement ? center.querySelector('header') : null
  if (header instanceof HTMLElement) header.setAttribute('data-dcs-header', '')
}

/** Locate the details column via the plugin marker, then the overlay's previous sibling. */
export function detailsColumnOf(frame: ParentNode | null | undefined): HTMLElement | undefined {
  if (frame === null || frame === undefined) return undefined
  const marked = frame.querySelector('[data-dcs-details]')
  if (marked instanceof HTMLElement) return marked
  const overlay = frame.querySelector('[data-shell-overlay]')
  const sibling = overlay?.previousElementSibling
  return sibling instanceof HTMLElement ? sibling : undefined
}

/** Pin the details track immediately so ResizeObserver cannot restore a stale open width. */
export function pinHostDetailsTrack(collapsed: boolean | undefined): void {
  if (typeof document === 'undefined') return
  const frame = document.querySelector('[data-shell-overlay]')?.parentElement
  if (!(frame instanceof HTMLElement)) return
  markHostFrame(frame)
  const viewport = frame.getBoundingClientRect().width || window.innerWidth
  const details = detailsTrackPx(collapsed, peekDrawerWidth(viewport))
  if (frame.style.getPropertyValue('--dcs-details-track') !== details) {
    frame.style.setProperty('--dcs-details-track', details)
  }
  if (frame.getAttribute('data-dcs-pin') !== '') frame.setAttribute('data-dcs-pin', '')
  if (collapsed === false) frame.setAttribute('data-dcs-open', '')
  else frame.removeAttribute('data-dcs-open')
}
