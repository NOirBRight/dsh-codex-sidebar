/** Details-column occupant: Tab strip, Palette, and the active 工具. */

import { useEffect, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from './shim.js'
import type { Intent, SidebarSnapshot, ToolKind } from '../session.ts'
import { tabAuxIntent } from '../tab-events.ts'
import { FilesPane } from './FilesPane.tsx'
import { Ico, tabIcon } from './icons.tsx'
import { NS, type SidebarKey } from './locales.ts'
import { AddMenu, Palette } from './Palette.tsx'
import { BrowserPane } from './BrowserPane.tsx'
import { ReviewPane } from './ReviewPane.tsx'
import { TerminalPane } from './TerminalPane.tsx'
import { TerminalRail } from './TerminalRail.tsx'
import type { BrowserCaptureReply, SidebarStore } from './controller.ts'
import type { BrowserLayout } from '../managed-browser-protocol.ts'
import { SidebarController } from './controller.ts'
import { AttachmentStrip } from './AttachmentChips.tsx'
import { OccupantBoundary } from './OccupantBoundary.tsx'
import { browserSurfaceOccupants } from './browser-occupancy.ts'

export interface SidebarFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
  controller: SidebarController
}

export type SidebarProps =
  PropsRuntime<'details'>
  & PropsLocale<typeof NS>
  & InjectFace<SidebarFace>

export function SidebarPanel({
  sessionId, useSessions, useSidebar, controller, t,
}: SidebarProps): ReactNode {
  useEffect(() => {
    const abort = new AbortController()
    void controller.refresh(String(sessionId), abort.signal)
    return () => { abort.abort() }
  }, [controller, sessionId])

  const snapshot = useSidebar((state) => state.bySession[String(sessionId)])
  const cwd = useSessions((list) => list.byId[sessionId]?.cwd)
  const workspaceName = basename(cwd)

  return (
    <OccupantBoundary
      label={t('occupantError')}
      retryLabel={t('occupantRetry')}
      onRetry={() => { void controller.refresh(String(sessionId)) }}
    >
      {snapshot !== undefined && (
        <div className="dcs-col" data-collapsed={snapshot.collapsed || undefined}>
          <SidebarChrome
            snapshot={snapshot}
            workspaceName={workspaceName}
            t={t}
            onIntent={(intent) => { void controller.dispatch(String(sessionId), intent) }}
            onPullTerminal={(tabId, since) => controller.pullTerminal(String(sessionId), tabId, since)}
            onBrowserTicket={(tabId) => controller.browserStreamTicket(String(sessionId), tabId)}
            onBrowserCapture={(tabId, expected) => controller.browserCapture(String(sessionId), tabId, expected)}
            onFilePreview={(path) => controller.readFilePreview(String(sessionId), path)}
          />
        </div>
      )}
    </OccupantBoundary>
  )
}

const TAB_DRAG_PX = 6

type TabPointer = {
  from: number
  x: number
  y: number
  pointerId: number
  armed: boolean
}

function tabIndexFromPoint(x: number, y: number): number | null {
  const node = document.elementFromPoint(x, y)
  const tab = node instanceof Element ? node.closest('.dcs-tab') : null
  if (!(tab instanceof HTMLElement) || tab.parentElement === null) return null
  const index = [...tab.parentElement.querySelectorAll(':scope > .dcs-tab')].indexOf(tab)
  return index < 0 ? null : index
}

function SidebarChrome({
  snapshot,
  workspaceName,
  t,
  onIntent,
  onPullTerminal,
  onBrowserTicket,
  onBrowserCapture,
  onFilePreview,
}: {
  snapshot: SidebarSnapshot
  workspaceName: string
  t: (key: SidebarKey) => string
  onIntent: (intent: Intent) => void
  onPullTerminal: (tabId: string, since: number) => Promise<{ seq: number; chunk: string } | undefined>
  onBrowserTicket: (tabId: string) => Promise<{ path: string; expiresAt: number } | undefined>
  onBrowserCapture: (tabId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>) => Promise<BrowserCaptureReply | undefined>
  onFilePreview: (path: string) => Promise<string | undefined>
}): ReactElement {
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.active)
  const browserOccupants = browserSurfaceOccupants(snapshot.tabs, snapshot.active)
  const fill = active?.kind === 'Files' || active?.kind === 'Review' || active?.kind === 'Terminal'
    || active?.kind === 'Browser'
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const tabPointer = useRef<TabPointer | null>(null)
  const ignoreTabClick = useRef(false)
  const stripRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stripRef.current
    if (el === null) return
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const frame = requestAnimationFrame(() => {
      const el = strip.querySelector<HTMLElement>('.dcs-tab[data-on]')
      if (el === null) return
      revealTab(strip, el)
    })
    return () => { cancelAnimationFrame(frame) }
  }, [snapshot.active, snapshot.tabs.length])

  useEffect(() => {
    if (!menu) return
    const onPointer = (event: globalThis.PointerEvent) => {
      const root = addRef.current
      if (root !== null && !root.contains(event.target as Node)) setMenu(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function pick(kind: ToolKind): void {
    setMenu(false)
    onIntent({ type: 'pick-tool', kind })
  }

  function onTabPointerDown(index: number, event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.dcs-x')) return
    tabPointer.current = {
      from: index,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      armed: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onTabPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const pending = tabPointer.current
    if (pending === null || pending.pointerId !== event.pointerId || pending.armed) return
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < TAB_DRAG_PX) return
    pending.armed = true
    setDragFrom(pending.from)
  }

  function onTabPointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const pending = tabPointer.current
    if (pending === null || pending.pointerId !== event.pointerId) return
    tabPointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!pending.armed) {
      setDragFrom(null)
      return
    }
    ignoreTabClick.current = true
    const to = tabIndexFromPoint(event.clientX, event.clientY)
    if (to !== null && to !== pending.from) {
      onIntent({ type: 'reorder-tabs', from: pending.from, to })
    }
    setDragFrom(null)
  }

  function onTabPointerCancel(event: PointerEvent<HTMLButtonElement>): void {
    if (tabPointer.current?.pointerId !== event.pointerId) return
    tabPointer.current = null
    setDragFrom(null)
  }

  return (
    <section className="dcs-root">
      <div className="dcs-tabbar">
        <div className="dcs-tab-scroll" ref={stripRef} data-reordering={dragFrom !== null || undefined}>
          {snapshot.tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              className="dcs-tab"
              data-on={tab.id === snapshot.active || undefined}
              data-drag={dragFrom === index || undefined}
              onClick={() => {
                if (ignoreTabClick.current) {
                  ignoreTabClick.current = false
                  return
                }
                onIntent({ type: 'select-tab', id: tab.id })
              }}
              onAuxClick={(event) => {
                const intent = tabAuxIntent(event.button, tab.id)
                if (intent === undefined) return
                event.preventDefault()
                onIntent(intent)
              }}
              onPointerDown={(event) => { onTabPointerDown(index, event) }}
              onPointerMove={onTabPointerMove}
              onPointerUp={onTabPointerUp}
              onPointerCancel={onTabPointerCancel}
            >
              <Ico name={tabIcon(tab.kind)} size={13} />
              <span className="dcs-title">{tab.title || t('newTab')}</span>
              <span
                className="dcs-x"
                role="button"
                aria-label={t('closeTab')}
                onPointerDown={(event) => { event.stopPropagation() }}
                onClick={(event) => {
                  event.stopPropagation()
                  onIntent({ type: 'close-tab', id: tab.id })
                }}
              >
                <Ico name="x" size={11} />
              </span>
            </button>
          ))}
        </div>
        <div className="dcs-add" ref={addRef}>
          <button
            type="button"
            className="dcs-plus"
            title={t('newTab')}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => { setMenu((open) => !open) }}
          >
            <Ico name="plus" size={14} />
          </button>
          {menu && <AddMenu onPick={pick} />}
        </div>
      </div>
      <AttachmentStrip
        attachments={snapshot.attachments}
        onEdit={(id) => { onIntent({ type: 'edit-attachment', id }) }}
        onSend={() => { onIntent({ type: 'composer-send', text: '' }) }}
        onRemove={(id) => { onIntent({ type: 'remove-attachment', id }) }}
      />
      <div className="dcs-body" data-center={snapshot.showPalette || undefined} data-fill={fill && !snapshot.showPalette || undefined}>
        {snapshot.showPalette && <Palette onPick={(kind) => { onIntent({ type: 'pick-tool', kind }) }} />}
        {!snapshot.showPalette && active?.kind === 'Files' && (
          <FilesPane
            snapshot={snapshot}
            workspaceName={workspaceName}
            onIntent={onIntent}
            onFilePreview={onFilePreview}
            annotateLabel={t('annotate')}
            openTreeLabel={t('openTree')}
            closeTreeLabel={t('closeTree')}
            notePlaceholder={t('notePlaceholder')}
            sendLabel={t('noteSend')}
            addLabel={t('noteAdd')}
            deleteLabel={t('noteDelete')}
            previewLabel={t('filesPreview')}
            diffLabel={t('filesDiff')}
          />
        )}
        {!snapshot.showPalette && active?.kind === 'Review' && (
          <ReviewPane snapshot={snapshot} onIntent={onIntent} />
        )}
        {browserOccupants.map((occupant) => {
          const browser = snapshot.browsers[occupant.tabId]
          if (browser === undefined) return null
          return (
            <div
              key={occupant.tabId}
              className="dcs-browser-occupant"
              hidden={!occupant.active}
              aria-hidden={!occupant.active || undefined}
              ref={(element) => { element?.toggleAttribute('inert', !occupant.active) }}
            >
              <BrowserPane
                snapshot={snapshot}
                browser={browser}
                tabId={occupant.tabId}
                active={occupant.active}
                onIntent={onIntent}
                requestTicket={onBrowserTicket}
                requestCapture={onBrowserCapture}
                sendLabel={t('noteSend')}
                addLabel={t('noteAdd')}
                deleteLabel={t('noteDelete')}
              />
            </div>
          )
        })}
        {!snapshot.showPalette && active?.kind === 'Terminal' && (
          <div className="dcs-term-wrap">
            <TerminalPane snapshot={snapshot} onIntent={onIntent} tabId={active.id} onPull={onPullTerminal} />
            <TerminalRail snapshot={snapshot} onIntent={onIntent} tabId={active.id} t={t} />
          </div>
        )}
      </div>
    </section>
  )
}

function revealTab(strip: HTMLElement, tab: HTMLElement): void {
  const pad = 12
  const track = strip.getBoundingClientRect()
  const box = tab.getBoundingClientRect()
  if (box.width >= track.width) {
    strip.scrollLeft += box.left - track.left
    return
  }
  if (box.left < track.left + pad) {
    strip.scrollLeft += box.left - track.left - pad
    return
  }
  if (box.right > track.right - pad) {
    strip.scrollLeft += box.right - track.right + pad
  }
}

function basename(cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0) return 'workspace'
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] ?? 'workspace'
}
