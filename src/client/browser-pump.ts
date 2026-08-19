/** Current-session Browser pump: one scheduler for the permanent iframe theater. */

import { liveHref } from '../browser.ts'
import type { SidebarController } from './controller.ts'
import {
  BROWSER_MIN_DOCK,
  browserFrameKey,
  browserFrames,
  type BrowserFrameBox,
  type BrowserFrameSurface,
} from './browser-frames.ts'

type SessionList = {
  getSnapshot: () => { current?: unknown }
  subscribe?: (listener: () => void) => () => void
}

export function pumpSessionId(list: { current?: unknown }, hidden: boolean): string | undefined {
  if (hidden) return undefined
  if (list.current === undefined) return undefined
  return String(list.current)
}

export function browserDockBox(rect: { left: number; top: number; width: number; height: number }): BrowserFrameBox | undefined {
  if (rect.width < BROWSER_MIN_DOCK || rect.height < BROWSER_MIN_DOCK) return undefined
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

export function browserSurface(box: BrowserFrameBox | undefined, passive = false, blocked = false): BrowserFrameSurface {
  if (box === undefined) return { mode: 'park' }
  return {
    mode: 'dock',
    box,
    pointerEvents: passive || blocked ? 'none' : 'auto',
    visibility: blocked ? 'hidden' : 'visible',
  }
}

export function startHiddenBrowserPump(input: {
  controller: SidebarController
  sessions: { list: SessionList }
}): () => void {
  if (typeof document === 'undefined') return () => {}
  let stopped = false
  let frame = 0
  const watched = new Set<Element>()
  const resize = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(() => { syncCurrent() })
  const attrs = typeof MutationObserver === 'undefined'
    ? undefined
    : new MutationObserver(() => { syncCurrent() })

  function observeDocks(): void {
    for (const dock of document.querySelectorAll('[data-dcs-browser-dock]')) {
      if (watched.has(dock)) continue
      watched.add(dock)
      resize?.observe(dock)
      attrs?.observe(dock, { attributes: true, attributeFilter: ['data-mark', 'data-gate'] })
    }
  }

  function syncCurrent(): void {
    if (stopped) return
    const id = pumpSessionId(input.sessions.list.getSnapshot(), document.hidden)
    if (id === undefined) return
    syncFrames(input.controller, id)
    observeDocks()
  }

  const syncAfterRender = (): void => {
    syncCurrent()
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() => { syncCurrent() })
  }

  const tick = (): void => {
    if (stopped) return
    const id = pumpSessionId(input.sessions.list.getSnapshot(), document.hidden)
    if (id === undefined) return
    void input.controller.refresh(id).then((snapshot) => {
      if (stopped || snapshot === undefined) return
      syncAfterRender()
    })
  }

  tick()
  const onVis = (): void => { if (!document.hidden) tick() }
  const onLayout = (): void => { syncCurrent() }
  document.addEventListener('visibilitychange', onVis)
  document.addEventListener('scroll', onLayout, true)
  window.addEventListener('resize', onLayout)
  window.visualViewport?.addEventListener('resize', onLayout)
  window.visualViewport?.addEventListener('scroll', onLayout)
  const stopList = input.sessions.list.subscribe === undefined
    ? () => {}
    : input.sessions.list.subscribe(() => { tick() })
  const stopController = input.controller.subscribe(() => { syncAfterRender() })
  return () => {
    stopped = true
    window.cancelAnimationFrame(frame)
    resize?.disconnect()
    attrs?.disconnect()
    watched.clear()
    document.removeEventListener('visibilitychange', onVis)
    document.removeEventListener('scroll', onLayout, true)
    window.removeEventListener('resize', onLayout)
    window.visualViewport?.removeEventListener('resize', onLayout)
    window.visualViewport?.removeEventListener('scroll', onLayout)
    stopList()
    stopController()
  }
}

function syncFrames(controller: SidebarController, sessionId: string): void {
  const host = browserFrames()
  const live = new Set<string>()
  const snapshot = controller.snap(sessionId)
  if (snapshot === undefined) {
    host.retain(live)
    return
  }
  for (const tab of snapshot.tabs) {
    if (tab.kind !== 'Browser') continue
    const rec = snapshot.browsers[tab.id] ?? (snapshot.active === tab.id ? snapshot.browser : undefined)
    const href = liveHref(rec?.url || tab.target)
    const framed = rec?.page?.frameUrl ?? ''
    const src = framed.startsWith('/__dcs/') ? framed : (liveHref(framed) ?? href)
    if (href === undefined || src === undefined) continue
    const key = browserFrameKey(sessionId, tab.id)
    live.add(key)
    host.ensure(key, src, rec?.page?.title ?? tab.title)
    const dock = document.querySelector('[data-dcs-browser-dock="' + key + '"]')
    const box = dock instanceof HTMLElement ? browserDockBox(dock.getBoundingClientRect()) : undefined
    const marked = dock instanceof HTMLElement && dock.hasAttribute('data-mark')
    const blocked = dock instanceof HTMLElement && dock.hasAttribute('data-gate')
    host.apply(key, browserSurface(box, marked, blocked))
  }
  host.retain(live)
}
