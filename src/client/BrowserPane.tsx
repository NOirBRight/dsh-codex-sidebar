/** Managed Chromium Browser chrome, Canvas stream, and screenshot-backed 批注. */

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactElement } from 'react'
import { BROWSER_DEVICE_PRESETS, liveHref, type BrowserDevice, type BrowserState } from '../browser.ts'
import { visibleAnnotations } from '../annotation.ts'
import type { Annotation, AnnotationRect, Intent, SidebarSnapshot } from '../session.ts'
import type { BrowserCaptureReply } from './controller.ts'
import type { BrowserLayout } from '../managed-browser-protocol.ts'
import { Ico, type IconName } from './icons.tsx'
import { ManagedBrowserCanvas } from './ManagedBrowserCanvas.tsx'
import { NoteComposer } from './NoteComposer.tsx'

const BROWSER_CSS = `
.dcs-browser-occupant { display:flex; flex:1; min-height:0; min-width:0; width:100%; }
.dcs-browser-occupant[hidden] { display:none; }
.dcs-browser { display:flex; flex-direction:column; flex:1; min-height:0; width:100%; position:relative; }
.dcs-b-chrome { display:flex; align-items:center; gap:2px; padding:8px 10px; border-bottom:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); flex-shrink:0; }
.dcs-b-nav { width:28px; height:28px; border:0; border-radius:6px; background:transparent; display:grid; place-items:center; color:var(--dsw-alias-label-tertiary); }
.dcs-b-nav[data-on] { color:var(--dsw-alias-label-primary); cursor:pointer; }
.dcs-b-nav[data-on]:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dcs-b-url { flex:1; display:flex; align-items:center; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:8px; height:32px; padding:0 6px 0 10px; }
.dcs-b-url input { flex:1; background:transparent; border:0; color:var(--dsw-alias-label-primary); outline:none; font-size:12.5px; padding:0; min-width:0; }
.dcs-b-device { position:relative; flex-shrink:0; }
.dcs-b-device-trigger { width:38px; height:32px; display:flex; align-items:center; justify-content:center; gap:1px; border:0; border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); cursor:pointer; }
.dcs-b-device-trigger:hover, .dcs-b-device-trigger[data-open] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dcs-b-device-chevron { display:grid; place-items:center; opacity:.72; }
.dcs-b-device-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:30; box-sizing:border-box; min-width:230px; width:max-content; max-width:min(280px, 70vw); max-height:calc(100vh - 84px); overflow:auto; padding:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-base); box-shadow:var(--dsw-shadow-lv2); font-family:var(--dsw-font-family); font-size:12.5px; font-weight:500; line-height:18px; color:var(--dsw-alias-label-primary); }
.dcs-b-device-option { display:grid; grid-template-columns:16px 18px minmax(0, 1fr); align-items:center; gap:8px; width:100%; border:0; border-radius:7px; padding:7px 8px; background:transparent; color:var(--dsw-alias-label-primary); text-align:left; font:inherit; line-height:18px; cursor:pointer; }
.dcs-b-device-option:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dcs-b-device-option[data-selected] { background:var(--dsw-alias-bg-layer-2); }
.dcs-b-device-check { color:var(--dsw-alias-label-secondary); font-size:12px; text-align:center; }
.dcs-b-device-icon { width:18px; height:18px; display:grid; place-items:center; color:var(--dsw-alias-label-tertiary); }
.dcs-b-device-option[data-selected] .dcs-b-device-icon { color:var(--dsw-alias-label-primary); }
.dcs-b-empty { flex:1; min-height:0; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-bg-base); }
.dcs-b-empty h2 { margin:10px 0 0; font-size:17px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.dcs-b-empty p { margin:0; font-size:13px; color:var(--dsw-alias-label-tertiary); max-width:320px; text-align:center; }
.dcs-b-page { flex:1; min-height:0; width:100%; position:relative; overflow:hidden; background:#fff; }
.dcs-managed-browser { position:absolute; inset:0; overflow:hidden; display:grid; place-items:center; background:#f3f4f6; }
.dcs-managed-browser-surface { position:relative; flex:none; overflow:hidden; background:#fff; box-shadow:0 1px 8px rgba(15,23,42,.16); }
.dcs-managed-browser-canvas { width:100%; height:100%; display:block; object-fit:contain; object-position:center; touch-action:none; user-select:none; outline:none; }
.dcs-managed-ime { position:absolute; left:-10000px; top:0; width:1px; height:1px; opacity:0; }
.dcs-managed-browser-status { position:absolute; inset:0; z-index:6; display:grid; place-items:center; pointer-events:none; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-base); font-size:13px; }
.dcs-managed-selected, .dcs-managed-hover, .dcs-managed-selection { position:absolute; pointer-events:none; box-sizing:border-box; z-index:2; }
.dcs-managed-selected { border:2px solid #0ea5e9; background:rgba(14,165,233,.2); box-shadow:0 0 0 1px rgba(255,255,255,.7) inset; }
.dcs-managed-hover { border:1.5px solid #38bdf8; background:rgba(56,189,248,.1); }
.dcs-managed-selection { border:1.5px solid #38bdf8; background:rgba(56,189,248,.18); }
.dcs-b-chrome > .dcs-tool[data-on] { background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.dcs-b-capturing { position:absolute; left:50%; bottom:10px; transform:translateX(-50%); z-index:5; pointer-events:none; padding:5px 10px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); font-size:12px; }
.dcs-b-badge { position:absolute; z-index:4; border:0; border-radius:999px; min-width:18px; height:18px; padding:0 5px; transform:translate(-50%,-100%); background:#38bdf8; color:#0f172a; font-size:11px; font-weight:700; cursor:pointer; }
.dcs-b-hl { position:absolute; pointer-events:none; z-index:3; box-sizing:border-box; border:1.5px solid #7dd3fc; background:rgba(125,211,252,.16); }
`

function ensureBrowserStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById('dsh-codex-sidebar-browser-css') as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = 'dsh-codex-sidebar-browser-css'
    document.head.appendChild(style)
  }
  style.textContent = BROWSER_CSS
}

type Ticket = { path: string; expiresAt: number }

export function BrowserPane({ snapshot, browser, tabId, active, onIntent, requestTicket, requestCapture, sendLabel, addLabel, deleteLabel }: {
  snapshot: SidebarSnapshot
  browser: BrowserState
  tabId: string
  active: boolean
  onIntent: (intent: Intent) => void
  requestTicket: (tabId: string) => Promise<Ticket | undefined>
  requestCapture: (tabId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>) => Promise<BrowserCaptureReply | undefined>
  sendLabel: string
  addLabel: string
  deleteLabel: string
}): ReactElement {
  ensureBrowserStyles()
  const bodyRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(browser.draft)
  const [capturing, setCapturing] = useState(false)
  const [deviceOverride, setDeviceOverride] = useState<BrowserDevice | null>(null)
  const device = deviceOverride ?? browser.device
  const href = liveHref(browser.url)
  const hasPage = href !== undefined

  useEffect(() => { setDraft(browser.draft) }, [browser.draft])
  useEffect(() => { setDeviceOverride(null) }, [browser.device])
  useEffect(() => {
    if (!active || !browser.annotate) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      onIntent({ type: 'browser-set-annotate', on: false })
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [active, browser.annotate, onIntent])

  const submitUrl = (event: FormEvent): void => {
    event.preventDefault()
    onIntent({ type: 'open-url', url: draft })
  }

  const openLive = (): void => {
    if (href === undefined) return
    onIntent({ type: 'browser-open-external' })
    window.open(href, '_blank', 'noopener')
  }

  const pick = async (rect: AnnotationRect, anchor: { x: number; y: number }, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<void> => {
    if (tabId === undefined || capturing) return
    setCapturing(true)
    try {
      const capture = await requestCapture(tabId, expected)
      if (capture === undefined) return
      if (capture.layoutRevision !== expected.revision || capture.mediaGeneration !== expected.mediaGeneration) return
      const hit = targetFor(rect, capture)
      const page = pageRef.current
      const body = bodyRef.current
      const x = anchor.x + (page?.offsetLeft ?? 0)
      const y = anchor.y + (page?.offsetTop ?? 0)
      onIntent({
        type: 'browser-click-content',
        mark: hit === undefined ? areaCaption(rect) : nodeCaption(hit),
        x: body === null ? x : Math.min(body.clientWidth - 12, Math.max(12, x)),
        y: body === null ? y : Math.min(body.clientHeight - 12, Math.max(12, y)),
        captureId: capture.captureId,
        documentId: capture.documentId,
        layoutRevision: capture.layoutRevision,
        mediaGeneration: capture.mediaGeneration,
        ...hit === undefined ? { rect } : { selector: hit.selector, rect: hit.rect ?? rect },
      })
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="dcs-browser" ref={bodyRef}>
      <div className="dcs-b-chrome">
        <NavButton title="后退" enabled={browser.canBack} icon="back" onClick={() => { onIntent({ type: 'browser-back' }) }} />
        <NavButton title="前进" enabled={browser.canForward} icon="fwd" onClick={() => { onIntent({ type: 'browser-forward' }) }} />
        <NavButton title="刷新" enabled={hasPage} icon="refresh" onClick={() => { onIntent({ type: 'browser-refresh' }) }} />
        <form className="dcs-b-url" onSubmit={submitUrl}>
          <input value={draft} placeholder="Enter a URL" onChange={(event) => { setDraft(event.target.value) }} />
          <NavButton title="外部打开" enabled={hasPage} icon="external" onClick={openLive} />
        </form>
        <DevicePicker value={device} onChange={(next) => {
          setDeviceOverride(next)
          onIntent({ type: 'browser-set-device', device: next })
        }} />
        {browser.canAnnotate && (
          <button type="button" title="批注" className="dcs-tool" data-on={browser.annotate || undefined} onClick={() => { onIntent({ type: 'browser-set-annotate', on: !browser.annotate }) }}>
            <Ico name="pencil" size={14} />
          </button>
        )}
      </div>
      {browser.status === 'empty' && <Empty title="打开网页" detail="输入 URL，在侧栏里查看页面" />}
      {browser.status !== 'empty' && href === undefined && (
        <Empty title="无法打开" detail={browser.runtimeError ?? '需要 http 或 https 地址'} />
      )}
      {browser.status !== 'empty' && href !== undefined && (
        <div className="dcs-b-page" ref={pageRef}>
          <ManagedBrowserCanvas
            tabId={tabId}
            active={active}
            device={device}
            annotate={browser.annotate}
            selectedRect={browser.pendingRect}
            selectedSelector={browser.pendingSelector}
            requestTicket={requestTicket}
            onPick={pick}
            onState={(projection) => {
              onIntent({
                type: 'browser-runtime-sync',
                tabId,
                url: projection.url,
                title: projection.title,
                documentId: projection.documentId,
                status: projection.status,
                ...projection.error === undefined ? {} : { error: projection.error },
              })
            }}
          >
            <StackedBadges attachments={visibleAnnotations(snapshot)} url={browser.url} onEdit={(id, event) => {
              const body = bodyRef.current
              const box = body?.getBoundingClientRect()
              if (snapshot.attachments.some((item) => item.id === id)) {
                onIntent({ type: 'edit-attachment', id, x: box === undefined ? 180 : event.clientX - box.left, y: box === undefined ? 72 : event.clientY - box.top })
                return
              }
              const delivered = snapshot.deliveredMarks.find((item) => item.id === id)
              if (delivered !== undefined) onIntent({ type: 'reveal-mark', mark: delivered })
            }} />
          </ManagedBrowserCanvas>
          {capturing && <div className="dcs-b-capturing">Capturing screenshot…</div>}
        </div>
      )}
      {browser.pendingMark !== null && browser.notePos !== null && (
        <NoteComposer
          containerRef={bodyRef}
          viewportRef={pageRef}
          anchor={browser.notePos}
          value={browser.noteDraft}
          objectText={shortCaption(browser.pendingMark)}
          placeholder="批注"
          sendLabel={sendLabel}
          addLabel={addLabel}
          deleteLabel={deleteLabel}
          editing={browser.editingId !== null}
          onDelete={() => { if (browser.editingId !== null) onIntent({ type: 'remove-attachment', id: browser.editingId }) }}
          onChange={(text) => { onIntent({ type: 'browser-set-note-draft', text }) }}
          onAdd={() => { onIntent({ type: 'browser-note-add' }) }}
          onSend={() => { onIntent({ type: 'browser-note-send' }) }}
          onDismiss={() => { onIntent({ type: 'browser-dismiss-note' }) }}
        />
      )}
    </div>
  )
}

function NavButton({ title, enabled, icon, onClick }: { title: string; enabled: boolean; icon: 'back' | 'fwd' | 'refresh' | 'external'; onClick: () => void }): ReactElement {
  return <button type="button" title={title} className="dcs-b-nav" data-on={enabled || undefined} disabled={!enabled} onClick={onClick}><Ico name={icon} size={15} /></button>
}

function DevicePicker({ value, onChange }: { value: BrowserDevice; onChange: (device: BrowserDevice) => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = BROWSER_DEVICE_PRESETS.find((preset) => preset.id === value) ?? BROWSER_DEVICE_PRESETS[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="dcs-b-device" ref={rootRef}>
      <button
        type="button"
        className="dcs-b-device-trigger"
        data-open={open || undefined}
        aria-label={selected?.label ?? '页面尺寸'}
        title={selected?.label ?? '页面尺寸'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((current) => !current) }}
      >
        <Ico name={deviceIcon(value)} size={20} />
        <span className="dcs-b-device-chevron"><Ico name="chevron-down" size={10} /></span>
      </button>
      {open && (
        <div className="dcs-b-device-menu" role="menu" aria-label="页面尺寸">
          {BROWSER_DEVICE_PRESETS.map((preset) => {
            const current = preset.id === value
            return (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className="dcs-b-device-option"
                data-selected={current || undefined}
                onClick={() => {
                  onChange(preset.id)
                  setOpen(false)
                }}
              >
                <span className="dcs-b-device-check">{current ? '✓' : ''}</span>
                <span className="dcs-b-device-icon"><Ico name={deviceIcon(preset.id)} size={16} /></span>
                <span>{preset.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function deviceIcon(device: BrowserDevice): IconName {
  if (device === 'phone') return 'device-phone'
  if (device === 'tablet') return 'device-tablet'
  if (device === 'laptop') return 'device-laptop'
  return 'device-responsive'
}

function Empty({ title, detail }: { title: string; detail: string }): ReactElement {
  return <div className="dcs-b-empty"><Ico name="globe" size={48} /><h2>{title}</h2><p>{detail}</p></div>
}

function targetFor(rect: AnnotationRect, capture: BrowserCaptureReply): BrowserCaptureReply['nodes'][number] | undefined {
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  return capture.nodes
    .filter((node) => node.rect !== undefined && contains(node.rect, center))
    .sort((left, right) => area(left.rect) - area(right.rect))[0]
}

function contains(rect: AnnotationRect | undefined, point: { x: number; y: number }): boolean {
  return rect !== undefined && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
}

function area(rect: AnnotationRect | undefined): number {
  return rect === undefined ? Number.POSITIVE_INFINITY : rect.w * rect.h
}

function nodeCaption(node: BrowserCaptureReply['nodes'][number]): string {
  return (node.name.trim() || node.selector || node.role).slice(0, 120)
}

function areaCaption(rect: AnnotationRect): string {
  return 'area ' + Math.round(rect.x) + ',' + Math.round(rect.y) + ' ' + Math.round(rect.w) + '×' + Math.round(rect.h)
}

function shortCaption(value: string): string {
  return value.length <= 44 ? value : value.slice(0, 41) + '…'
}

function StackedBadges({ attachments, url, onEdit }: {
  attachments: readonly Annotation[]
  url: string
  onEdit: (id: string, event: MouseEvent<HTMLButtonElement>) => void
}): ReactElement | null {
  const marks = attachments.flatMap((item, index) => {
    if (item.source !== 'browser' || item.evidence === undefined || (item.url !== undefined && item.url !== url)) return []
    const rect = item.rect ?? { x: 18 + index * 22, y: 18, w: 0, h: 0 }
    return [{ item, n: index + 1, rect }]
  })
  if (marks.length === 0) return null
  return <>{marks.map(({ item, n, rect }) => {
    const width = item.evidence?.width ?? 1
    const height = item.evidence?.height ?? 1
    const style = { left: rect.x / width * 100 + '%', top: rect.y / height * 100 + '%', width: rect.w / width * 100 + '%', height: rect.h / height * 100 + '%' }
    return <div key={item.id}>
      {rect.w > 1 && rect.h > 1 && <div className="dcs-b-hl" style={style} />}
      <button type="button" className="dcs-b-badge" style={{ left: style.left, top: style.top }} onClick={(event) => { onEdit(item.id, event) }}>{n}</button>
    </div>
  })}</>
}
