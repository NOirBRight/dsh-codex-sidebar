/**
 * Pins AppFrame's third grid track to the 侧栏 width so the center column
 * is squeezed (3-column layout). The 侧栏开关 and resize handle live here
 * so the switch stays put and the pill stays on the real seam.
 */

import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { overlayHandleVisible, overlayToggleVisible, seamOffsetPx } from './chrome.ts'
import {
  clampDrawerWidth,
  peekDrawerWidth,
  publishDrawerWidth,
  subscribeDrawerWidth,
} from './drawer-width.ts'
import { detailsTrackPx, sidebarTrackFromGrid } from './host-frame.ts'
import { NS } from './locales.ts'
import type { SidebarFace } from './Sidebar.tsx'
import { SidebarToggleButton } from './Toggle.tsx'

export type DrawerProps =
  PropsRuntime<'shell.overlay'>
    & PropsLocale<typeof NS>
    & InjectFace<SidebarFace>

export function NarrowDrawer(props: DrawerProps): ReactElement {
  const sessionId = props.useSessions((list) => list.current)
  const collapsed = props.useSidebar((state) => (
    sessionId === undefined ? undefined : state.bySession[String(sessionId)]?.collapsed
  ))
  usePinFrameColumns(sessionId !== undefined, collapsed)
  useLayoutEffect(() => {
    if (sessionId === undefined) return
    props.controller.syncTrack(collapsed)
  }, [sessionId, collapsed, props.controller])

  return (
    <div className="dcs-overlay">
      {overlayToggleVisible(sessionId === undefined ? undefined : String(sessionId)) && (
        <SidebarToggleButton
          collapsed={collapsed !== false}
          t={props.t}
          onClick={() => {
            if (sessionId === undefined) return
            if (collapsed !== false) props.controller.reveal(String(sessionId))
            else {
              props.controller.syncTrack(true)
              void props.controller.dispatch(String(sessionId), { type: 'toggle-collapsed' })
            }
          }}
        />
      )}
      {overlayHandleVisible(collapsed) && <SidebarResizeHandle label={props.t('resizeDrawer')} />}
    </div>
  )
}

function usePinFrameColumns(active: boolean, collapsed: boolean | undefined): void {
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
      if (collapsed === false) frame.setAttribute('data-dcs-open', '')
      else frame.removeAttribute('data-dcs-open')
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
        frame.removeAttribute('data-dcs-open')
      }
    }
    return () => { unsub() }
  }, [active, collapsed])
}

function pinHandleToSeam(handle: HTMLElement): void {
  const layer = handle.closest('[data-shell-overlay]')
  const frame = layer?.parentElement
  const details = frame?.querySelector('[class*="detailsCol"]')
  if (!(details instanceof HTMLElement)) return
  const origin = handle.offsetParent instanceof HTMLElement ? handle.offsetParent : handle.parentElement
  if (origin === null) return
  handle.style.left = `${seamOffsetPx(origin.getBoundingClientRect().left, details.getBoundingClientRect().left)}px`
}

function SidebarResizeHandle({ label }: { label: string }): ReactElement {
  const handleRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ originX: number; startWidth: number } | null>(null)
  const viewportRef = useRef(typeof window === 'undefined' ? 1280 : window.innerWidth)

  useLayoutEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement
    const details = frame?.querySelector('[class*="detailsCol"]')
    const read = (): void => {
      const next = (frame ?? document.body).getBoundingClientRect().width
      if (next > 0) viewportRef.current = next
      pinHandleToSeam(handle)
    }
    read()
    const unsub = subscribeDrawerWidth(() => { read() })
    const resize = new ResizeObserver(read)
    if (frame instanceof HTMLElement) resize.observe(frame)
    if (details instanceof HTMLElement) resize.observe(details)
    return () => {
      unsub()
      resize.disconnect()
    }
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      originX: event.clientX,
      startWidth: peekDrawerWidth(viewportRef.current),
    }
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const next = clampDrawerWidth(
      drag.current.startWidth + (drag.current.originX - event.clientX),
      viewportRef.current,
    )
    publishDrawerWidth(next, viewportRef.current)
    pinHandleToSeam(event.currentTarget)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
    setDragging(false)
    publishDrawerWidth(peekDrawerWidth(viewportRef.current), viewportRef.current)
    pinHandleToSeam(event.currentTarget)
  }

  return (
    <div
      ref={handleRef}
      className="dcs-col-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
