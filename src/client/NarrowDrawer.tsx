/**
 * Pins AppFrame's third grid track to the 侧栏 width so the center column
 * is squeezed (3-column layout). Does not paint an overlay pane.
 */

import { useLayoutEffect, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  peekDrawerWidth,
  subscribeDrawerWidth,
} from './drawer-width.ts'
import { detailsTrackPx, sidebarTrackFromGrid } from './host-frame.ts'
import { NS } from './locales.ts'
import type { SidebarFace } from './Sidebar.tsx'

export type DrawerProps =
  PropsRuntime<'shell.overlay'>
    & PropsLocale<typeof NS>
    & InjectFace<SidebarFace>

export function NarrowDrawer(props: DrawerProps): ReactElement | null {
  const sessionId = props.useSessions((list) => list.current)
  const collapsed = props.useSidebar((state) => (
    sessionId === undefined ? true : state.bySession[String(sessionId)]?.collapsed
  )) ?? true
  usePinFrameColumns(sessionId !== undefined, collapsed)
  useLayoutEffect(() => {
    if (sessionId === undefined) return
    props.controller.syncTrack(collapsed)
  }, [sessionId, collapsed, props.controller])
  return null
}

function usePinFrameColumns(active: boolean, collapsed: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay?.parentElement
    const apply = (): void => {
      if (frame === null || frame === undefined) return
      const viewport = frame.getBoundingClientRect().width || window.innerWidth
      const fromInline = sidebarTrackFromGrid(frame.style.gridTemplateColumns)
      const fromComputed = sidebarTrackFromGrid(getComputedStyle(frame).gridTemplateColumns)
      const sidebar = fromInline ?? fromComputed
      if (sidebar !== undefined && frame.style.getPropertyValue('--dcs-sidebar-track') !== sidebar) {
        frame.style.setProperty('--dcs-sidebar-track', sidebar)
      }
      const details = detailsTrackPx(collapsed, peekDrawerWidth(viewport))
      if (frame.style.getPropertyValue('--dcs-details-track') !== details) {
        frame.style.setProperty('--dcs-details-track', details)
      }
    }
    apply()
    const unsub = subscribeDrawerWidth(() => { apply() })
    const observer = new MutationObserver(apply)
    if (frame !== null && frame !== undefined) {
      observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
      const resize = new ResizeObserver(apply)
      resize.observe(frame)
      return () => {
        unsub()
        observer.disconnect()
        resize.disconnect()
      }
    }
    return () => { unsub() }
  }, [active, collapsed])
}
