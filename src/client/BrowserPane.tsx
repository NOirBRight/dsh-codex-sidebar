/** Browser 工具: URL chrome, empty / unreachable / loaded page, 批注 at the mark. */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { liveHref } from '../browser.ts'
import { browserFrameKey, browserFrames } from './browser-frames.ts'
import {
  clampRect,
  DCS_NAV,
  DCS_PICK_HIT,
  DCS_PICK_SCAN,
  DCS_PICK_SCAN_HIT,
  DCS_PICK_TYPE,
  formatElementMark,
  formatLassoMark,
  formatPickLabel,
  formatPickMark,
  isLassoGesture,
  isLoopbackHttpUrl,
  liveUrlFromFrameSrc,
  mapIframeRect,
  pickElementName,
  placePill,
  rectFromPoints,
  rectsIntersect,
  shortPickCaption,
  type PickRect,
} from '../browser-pick.ts'
import type { Annotation, Intent, SidebarSnapshot } from '../session.ts'
import { Ico } from './icons.tsx'
import { NoteComposer } from './NoteComposer.tsx'

const BROWSER_CSS = `
.dcs-browser { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; position: relative; }
.dcs-b-chrome {
  display: flex; align-items: center; gap: 2px;
  padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); flex-shrink: 0;
}
.dcs-b-nav {
  width: 28px; height: 28px; border: 0; border-radius: 6px;
  background: transparent; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary);
}
.dcs-b-nav[data-on] { color: var(--dsw-alias-label-primary); cursor: pointer; }
.dcs-b-nav[data-on]:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-b-url {
  flex: 1; display: flex; align-items: center;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px; height: 32px; padding: 0 6px 0 10px;
}
.dcs-b-url input {
  flex: 1; background: transparent; border: 0; color: var(--dsw-alias-label-primary);
  outline: none; font-size: 12.5px; padding: 0;
}
.dcs-b-empty {
  flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base);
}
.dcs-b-empty h2 {
  margin: 10px 0 0; font-size: 17px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); letter-spacing: -0.02em;
}
.dcs-b-empty p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); max-width: 280px; text-align: center; }
.dcs-b-cta {
  margin-top: 16px; border: 0; border-radius: 8px; padding: 9px 16px;
  font-size: 13.5px; font-weight: 500; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
}
.dcs-b-page {
  flex: 1; background: transparent; position: relative; z-index: 4; min-height: 0; width: 100%;
  overflow: hidden; pointer-events: none;
}
.dcs-b-well { position: fixed; inset: 0; overflow: visible; pointer-events: none; z-index: 3; }
.dcs-b-frame { position: fixed; border: 0; background: #fff; z-index: 0; }
.dcs-b-gate { position: absolute; inset: 0; z-index: 1; pointer-events: auto; }
.dcs-b-mask {
  position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%;
  cursor: crosshair; background: transparent;
  pointer-events: auto; touch-action: none; user-select: none;
}
.dcs-b-page[data-mark] { cursor: crosshair; }
.dcs-b-hair {
  position: absolute; width: 22px; height: 22px;
  transform: translate(-50%, -50%); pointer-events: none; z-index: 3;
}
.dcs-b-hair::before, .dcs-b-hair::after {
  content: ''; position: absolute; background: #2563eb;
}
.dcs-b-hair::before { left: 50%; top: 2px; bottom: 2px; width: 1px; transform: translateX(-50%); }
.dcs-b-hair::after { top: 50%; left: 2px; right: 2px; height: 1px; transform: translateY(-50%); }
.dcs-b-chrome > .dcs-tool[data-on] {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}
.dcs-b-hl {
  position: absolute; pointer-events: none; box-sizing: border-box;
  border: 1.5px solid #7dd3fc; background: rgba(125, 211, 252, 0.16);
  z-index: 3;
}
.dcs-b-hl[data-kind="lasso"] { background: rgba(125, 211, 252, 0.22); }
.dcs-b-pill {
  position: absolute; z-index: 4; pointer-events: none;
  height: 18px; padding: 0 6px; box-sizing: border-box;
  font-size: 11px; line-height: 18px; font-weight: 500;
  background: #38bdf8; color: #0f172a;
  border-radius: 4px 4px 0 0;
  white-space: nowrap; max-width: min(280px, calc(100% - 8px));
  overflow: hidden; text-overflow: ellipsis;
}
.dcs-b-pill[data-flip] { border-radius: 0 0 4px 4px; }
.dcs-b-badge {
  position: absolute; z-index: 4; pointer-events: none;
  min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
  border-radius: 999px;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 11px; font-weight: 700; line-height: 1;
  transform: translate(-50%, -100%);
  margin-top: -2px;
}
.dcs-b-hint {
  position: absolute; z-index: 3; left: 50%; bottom: 10px;
  transform: translateX(-50%); pointer-events: none;
  font-size: 12px; line-height: 1.3; text-align: center;
  max-width: calc(100% - 24px); white-space: normal;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px; padding: 5px 12px;
}
.dcs-b-auth {
  position: absolute; z-index: 3; left: 50%; top: 10px;
  transform: translateX(-50%); pointer-events: none;
  font-size: 12px; line-height: 1.3; text-align: center;
  max-width: calc(100% - 24px);
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px; padding: 5px 12px;
}
.dcs-b-card { width: 260px; }
.dcs-b-card h1 {
  margin: 0; font-family: "Iowan Old Style", Palatino, "Palatino Linotype", serif;
  font-size: 28px; font-weight: 500; color: #1a1a1a;
}
.dcs-b-card button, .dcs-b-card .dcs-b-el {
  margin-top: 18px; background: #111; color: #fff; border: 0;
  padding: 9px 18px; border-radius: 6px; font-size: 13.5px;
}
.dcs-b-card [data-hit] { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
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

type FrameGate = 'live' | 'blocked' | 'failed'

function inspectFrame(frame: HTMLIFrameElement): 'live' | 'blank' {
  try {
    const doc = frame.contentDocument
    if (doc === null) return 'live'
    const url = doc.URL
    if (url.length === 0 || url === 'about:blank') return 'blank'
    return 'live'
  } catch {
    return 'live'
  }
}

export function BrowserPane({
  snapshot,
  onIntent,
  sendLabel,
  addLabel,
  sendTip,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
  sendLabel: string
  addLabel: string
  sendTip: string
}): ReactElement {
  ensureBrowserStyles()
  const browser = snapshot.browser
  const bodyRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const blankTimer = useRef(0)
  const [draft, setDraft] = useState(browser.draft)
  const [reload, setReload] = useState(0)
  const [gate, setGate] = useState<FrameGate>('live')
  const [caption, setCaption] = useState('')
  const hasPage = browser.url.trim().length > 0
  const href = liveHref(browser.url)
  const tabId = snapshot.tabs.find((tab) => tab.id === snapshot.active && tab.kind === 'Browser')?.id
  const frameKey = tabId === undefined ? undefined : browserFrameKey(snapshot.sessionId, tabId)
  const needsAuth = browser.page?.requiresAuth === true
  const directExternal = href !== undefined && !isLoopbackHttpUrl(href)

  useEffect(() => {
    setDraft(browser.draft)
  }, [browser.draft])

  useEffect(() => {
    setGate('live')
    return () => { window.clearTimeout(blankTimer.current) }
  }, [href, reload])

  useEffect(() => {
    let request = 0
    let attempts = 0
    const loaded = (): void => { onFrameLoad() }
    const failed = (): void => { onFrameError() }
    const bind = (): void => {
      const frame = frameKey === undefined ? undefined : browserFrames().get(frameKey)
      frameRef.current = frame ?? null
      if (frame === undefined) {
        attempts += 1
        if (href !== undefined && attempts < 4) request = window.requestAnimationFrame(bind)
        return
      }
      frame.onload = loaded
      frame.onerror = failed
      onFrameLoad()
    }
    bind()
    return () => {
      window.cancelAnimationFrame(request)
      const frame = frameRef.current
      if (frame?.onload === loaded) frame.onload = null
      if (frame?.onerror === failed) frame.onerror = null
      frameRef.current = null
    }
  }, [href, reload, frameKey, needsAuth])

  useEffect(() => {
    if (!browser.annotate) return
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (event.target instanceof HTMLInputElement) return
      event.preventDefault()
      onIntent({ type: 'browser-set-annotate', on: false })
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [browser.annotate, onIntent])

  useEffect(() => {
    function onNav(event: MessageEvent): void {
      if (event.data?.type !== DCS_NAV) return
      const frame = frameRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      const href = typeof event.data.href === 'string' ? event.data.href : ''
      const live = liveUrlFromFrameSrc(href) ?? href
      if (!/^https?:\/\//i.test(live)) return
      onIntent({ type: 'browser-follow', url: live })
    }
    window.addEventListener('message', onNav)
    return () => { window.removeEventListener('message', onNav) }
  }, [onIntent])

  function submitUrl(event: FormEvent): void {
    event.preventDefault()
    onIntent({ type: 'open-url', url: draft })
  }

  function openLive(): void {
    if (href === undefined) return
    onIntent({ type: 'browser-open-external' })
    window.open(href, '_blank', 'noopener')
  }

  function onFrameError(): void {
    setGate('failed')
  }

  function onFrameLoad(): void {
    const frame = frameRef.current
    if (frame === null) return
    window.clearTimeout(blankTimer.current)
    if (inspectFrame(frame) === 'live') {
      setGate('live')
      return
    }
    // The browser's own sign-in dialog leaves the frame blank; that is not a refusal.
    if (needsAuth) return
    blankTimer.current = window.setTimeout(() => {
      if (frameRef.current !== frame) return
      if (inspectFrame(frame) === 'blank') setGate('blocked')
    }, 1000)
  }

  return (
    <div className="dcs-browser" ref={bodyRef}>
      <div className="dcs-b-chrome">
        <button
          type="button"
          title="后退"
          className="dcs-b-nav"
          data-on={browser.canBack || undefined}
          disabled={!browser.canBack}
          onClick={() => { onIntent({ type: 'browser-back' }) }}
        >
          <Ico name="back" size={16} />
        </button>
        <button
          type="button"
          title="前进"
          className="dcs-b-nav"
          data-on={browser.canForward || undefined}
          disabled={!browser.canForward}
          onClick={() => { onIntent({ type: 'browser-forward' }) }}
        >
          <Ico name="fwd" size={16} />
        </button>
        <button
          type="button"
          title="刷新"
          className="dcs-b-nav"
          data-on={hasPage || undefined}
          disabled={!hasPage}
          onClick={() => {
            if (frameKey !== undefined) browserFrames().reload(frameKey)
            setReload((n) => n + 1)
            onIntent({ type: 'browser-refresh' })
          }}
        >
          <Ico name="refresh" size={15} />
        </button>
        <form className="dcs-b-url" onSubmit={submitUrl}>
          <input
            value={draft}
            placeholder="Enter a URL"
            onChange={(event) => { setDraft(event.target.value) }}
          />
          <button
            type="button"
            title="外部打开"
            className="dcs-b-nav"
            data-on={hasPage || undefined}
            disabled={!hasPage}
            onClick={openLive}
          >
            <Ico name="external" size={14} />
          </button>
        </form>
        {browser.canAnnotate && (
          <button
            type="button"
            title="批注"
            className="dcs-tool"
            data-on={browser.annotate || undefined}
            onClick={() => { onIntent({ type: 'browser-set-annotate', on: !browser.annotate }) }}
          >
            <Ico name="pencil" size={14} />
          </button>
        )}
      </div>
      {browser.status === 'empty' && (
        <div className="dcs-b-empty">
          <Ico name="globe" size={56} />
          <h2>打开网页</h2>
          <p>输入 URL，在侧栏里查看页面</p>
        </div>
      )}
      {browser.status !== 'empty' && href === undefined && (
        <div className="dcs-b-empty">
          <Ico name="globe" size={40} />
          <h2>无法打开</h2>
          <p>需要 http 或 https 地址</p>
        </div>
      )}
      {browser.status === 'unreachable' && href !== undefined && (
        <div className="dcs-b-empty">
          <Ico name="file" size={40} />
          <h2>无法连接</h2>
          <p>{href} 没有响应。当前没有服务在听这个地址，开发服务起来后再刷新。</p>
          <button
            type="button"
            className="dcs-b-cta"
            onClick={() => {
              setReload((n) => n + 1)
              onIntent({ type: 'browser-refresh' })
            }}
          >
            重试
          </button>
        </div>
      )}
      {browser.status === 'loaded' && href !== undefined && (
        <div
          className="dcs-b-page"
          ref={pageRef}
          data-dcs-browser-dock={frameKey}
          data-mark={browser.annotate || undefined}
          data-gate={gate === 'live' ? undefined : gate}
        >
          {(needsAuth || directExternal) && (
            <div className="dcs-b-auth">
              {needsAuth
                ? '该站点要求登录，请在页面里的登录框中填写凭据'
                : '外部站点可能拒绝嵌入；若页面空白，请用右上角按钮在新窗口打开'}
            </div>
          )}
          {gate === 'blocked' && (
            <div className="dcs-b-empty dcs-b-gate">
              <Ico name="globe" size={40} />
              <h2>页面拒绝嵌入</h2>
              <p>该站点禁止在侧栏里显示，可以用新窗口打开</p>
              <button type="button" className="dcs-b-cta" onClick={openLive}>在新窗口打开</button>
            </div>
          )}
          {gate === 'failed' && (
            <div className="dcs-b-empty dcs-b-gate">
              <Ico name="globe" size={40} />
              <h2>无法加载页面</h2>
              <p>地址打不开，或浏览器拦截了这次嵌入</p>
              <button type="button" className="dcs-b-cta" onClick={openLive}>在新窗口打开</button>
            </div>
          )}
          {browser.annotate && gate === 'live' && (
            <AnnotateMask
              frameRef={frameRef}
              paneRef={bodyRef}
              url={href}
              pending={browser.pendingMark !== null}
              onPick={(hit) => {
                setCaption(hit.caption)
                onIntent({
                  type: 'browser-click-content',
                  mark: hit.caption,
                  x: hit.x,
                  y: hit.y,
                  ...hit.selector === undefined ? {} : { selector: hit.selector },
                  ...hit.rect === undefined ? {} : { rect: hit.rect },
                })
              }}
            />
          )}
          <StackedBadges attachments={snapshot.attachments} />
        </div>
      )}
      {browser.pendingMark !== null && browser.notePos !== null && (
        <NoteComposer
          containerRef={bodyRef}
          viewportRef={pageRef}
          anchor={browser.notePos}
          value={browser.noteDraft}
          objectText={caption || shortPickCaption(browser.pendingMark)}
          placeholder="批注"
          sendLabel={sendLabel}
          addLabel={addLabel}
          sendTip={sendTip}
          onChange={(text) => { onIntent({ type: 'browser-set-note-draft', text }) }}
          onAdd={() => { onIntent({ type: 'browser-note-enter' }) }}
          onSend={() => { onIntent({ type: 'browser-note-ctrl-enter' }) }}
          onDismiss={() => { onIntent({ type: 'browser-dismiss-note' }) }}
        />
      )}
    </div>
  )
}

function StackedBadges({ attachments }: { attachments: readonly Annotation[] }): ReactElement | null {
  const marks = attachments.flatMap((item, index) => {
    if (item.source !== 'browser') return []
    return [{ n: index + 1, rect: item.rect ?? { x: 18 + index * 22, y: 18, w: 0, h: 0 }, id: item.id }]
  })
  if (marks.length === 0) return null
  return (
    <>
      {marks.map((item) => (
        <div
          key={item.id}
          className="dcs-b-badge"
          style={{ left: item.rect.x, top: item.rect.y }}
        >
          {item.n}
        </div>
      ))}
    </>
  )
}

type OverlayHit = {
  rect: PickRect
  label: string
  selector: string
}

type PickResult = {
  caption: string
  x: number
  y: number
  selector?: string
  rect?: PickRect
}

function AnnotateMask({
  frameRef,
  paneRef,
  url,
  pending,
  onPick,
}: {
  frameRef: RefObject<HTMLIFrameElement>
  paneRef: RefObject<HTMLDivElement>
  url: string
  pending: boolean
  onPick: (hit: PickResult) => void
}): ReactElement {
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const seq = useRef(0)
  const hoverRaf = useRef(0)
  const [hover, setHover] = useState<OverlayHit | null>(null)
  const [lasso, setLasso] = useState<PickRect | null>(null)
  const [commit, setCommit] = useState<OverlayHit | { rect: PickRect; label: string } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    return () => { window.cancelAnimationFrame(hoverRaf.current) }
  }, [])

  useEffect(() => {
    if (!pending) setCommit(null)
  }, [pending])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const local = overlayPoint(event.currentTarget, event.clientX, event.clientY)
    drag.current = { pointerId: event.pointerId, startX: local.x, startY: local.y }
    setCursor(local)
    setLasso(null)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const overlay = event.currentTarget
    const local = overlayPoint(overlay, event.clientX, event.clientY)
    const bounds = overlay.getBoundingClientRect()
    setCursor(local)
    const start = drag.current
    if (start !== null && event.pointerId === start.pointerId) {
      if (isLassoGesture(local.x - start.startX, local.y - start.startY)) {
        setHover(null)
        setLasso(clampRect(
          rectFromPoints(start.startX, start.startY, local.x, local.y),
          bounds.width,
          bounds.height,
        ))
      }
      return
    }
    if (pending) return
    window.cancelAnimationFrame(hoverRaf.current)
    hoverRaf.current = window.requestAnimationFrame(() => {
      void probeHit(overlay, frameRef.current, event.clientX, event.clientY, seq).then((hit) => {
        setHover(hit)
      })
    })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = drag.current
    if (start === null || event.pointerId !== start.pointerId) return
    drag.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    const overlay = event.currentTarget
    const local = overlayPoint(overlay, event.clientX, event.clientY)
    const bounds = overlay.getBoundingClientRect()
    const pane = paneRef.current
    setHover(null)
    setLasso(null)
    if (isLassoGesture(local.x - start.startX, local.y - start.startY)) {
      const rect = clampRect(
        rectFromPoints(start.startX, start.startY, local.x, local.y),
        bounds.width,
        bounds.height,
      )
      if (rect.w < 1 && rect.h < 1) return
      setCommit({ rect, label: '圈选' })
      const note = panePointFromRect(overlay, pane, rect)
      void finishLasso(overlay, frameRef.current, rect, seq).then((selectors) => {
        onPick({
          caption: '圈选',
          x: note.x,
          y: note.y,
          selector: selectors[0] ?? formatLassoMark(url, rect, selectors),
          rect,
        })
      })
      return
    }
    const note = toPanePoint(pane, event.clientX, event.clientY)
    void probeHit(overlay, frameRef.current, event.clientX, event.clientY, seq).then((hit) => {
      if (hit !== null) {
        setCommit(hit)
        onPick({
          caption: hit.label,
          x: note.x,
          y: note.y,
          selector: hit.selector,
          rect: hit.rect,
        })
        return
      }
      setCommit(null)
      onPick({
        caption: shortPickCaption(formatPickMark({
          mode: 'click',
          origin: 'cross',
          url,
          x: local.x,
          y: local.y,
        })),
        x: note.x,
        y: note.y,
        rect: { x: local.x, y: local.y, w: 1, h: 1 },
      })
    })
  }

  function onPointerLeave(): void {
    if (drag.current !== null) return
    setHover(null)
    setCursor(null)
  }

  const box = lasso ?? hover?.rect ?? commit?.rect ?? null
  const label = lasso !== null ? '圈选' : hover?.label ?? commit?.label ?? ''
  const kind = lasso !== null ? 'lasso' : hover !== null ? 'hover' : 'commit'
  const hair = lasso === null ? cursor : null

  return (
    <div
      className="dcs-b-mask"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 2,
        pointerEvents: 'auto',
        cursor: 'crosshair',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current = null
        setLasso(null)
      }}
      onPointerLeave={onPointerLeave}
    >
      <Highlight box={box} label={label} kind={kind} />
      {hair !== null && (
        <div className="dcs-b-hair" style={{ left: hair.x, top: hair.y }} />
      )}
      {!isLoopbackHttpUrl(url) && (
        <div className="dcs-b-hint">跨站页面无法点选内部元素；可圈选区域批注</div>
      )}
    </div>
  )
}

function Highlight({
  box,
  label,
  kind,
}: {
  box: PickRect | null
  label: string
  kind: string
}): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; y: number; flip: boolean } | null>(null)

  useEffect(() => {
    const overlay = ref.current?.parentElement
    if (box === null || overlay === null || overlay === undefined) {
      setPill(null)
      return
    }
    setPill(placePill(box, { w: overlay.clientWidth, h: overlay.clientHeight }))
  }, [box])

  if (box === null) return null
  return (
    <>
      <div
        ref={ref}
        className="dcs-b-hl"
        data-kind={kind}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      />
      {label.length > 0 && pill !== null && (
        <div
          className="dcs-b-pill"
          data-flip={pill.flip || undefined}
          style={{ left: pill.x, top: pill.y }}
        >
          {label}
        </div>
      )}
    </>
  )
}

function iframeDocument(frame: HTMLIFrameElement | null): Document | null {
  if (frame === null) return null
  try {
    const doc = frame.contentDocument
    if (doc === null) return null
    void doc.documentElement.tagName
    return doc
  } catch {
    return null
  }
}

function overlayPoint(overlay: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const box = overlay.getBoundingClientRect()
  return { x: clientX - box.left, y: clientY - box.top }
}

function toPanePoint(pane: HTMLElement | null, clientX: number, clientY: number): { x: number; y: number } {
  if (pane === null) return { x: clientX, y: clientY }
  const box = pane.getBoundingClientRect()
  return { x: clientX - box.left, y: clientY - box.top }
}

function panePointFromRect(
  overlay: HTMLElement,
  pane: HTMLElement | null,
  rect: PickRect,
): { x: number; y: number } {
  if (pane === null) return { x: rect.x + rect.w / 2, y: rect.y + rect.h }
  const overlayBox = overlay.getBoundingClientRect()
  const paneBox = pane.getBoundingClientRect()
  return {
    x: overlayBox.left - paneBox.left + rect.x + rect.w / 2,
    y: overlayBox.top - paneBox.top + rect.y + rect.h,
  }
}

function nthOfType(el: Element): number {
  const parent = el.parentElement
  if (parent === null) return 1
  const tag = el.tagName
  let n = 1
  for (const child of parent.children) {
    if (child === el) return n
    if (child.tagName === tag) n += 1
  }
  return n
}

function markForElement(el: Element): string {
  return formatElementMark(el.tagName, el.id, el.getAttribute('class') ?? '', nthOfType(el))
}

function hitElement(
  overlay: HTMLElement,
  frame: HTMLIFrameElement | null,
  clientX: number,
  clientY: number,
): OverlayHit | null {
  overlay.style.pointerEvents = 'none'
  try {
    const doc = iframeDocument(frame)
    if (doc === null || frame === null) return null
    const overlayBox = overlay.getBoundingClientRect()
    const frameBox = frame.getBoundingClientRect()
    const raw = doc.elementFromPoint(clientX - frameBox.left, clientY - frameBox.top)
    if (raw === null) return null
    const el = raw === doc.documentElement ? (doc.body ?? raw) : raw
    return overlayHitFromElement(el, overlayBox, frameBox)
  } finally {
    overlay.style.pointerEvents = 'auto'
  }
}

function overlayHitFromElement(
  el: Element,
  overlayBox: DOMRect,
  frameBox: DOMRect,
): OverlayHit {
  const b = el.getBoundingClientRect()
  const tag = el.tagName.toLowerCase()
  const name = pickElementName({
    tag,
    reactName: reactName(el),
    name: el.getAttribute('name') ?? '',
    dataAttrs: dataAttrs(el),
    id: el.id,
    className: el.getAttribute('class') ?? '',
  })
  const selector = markForElement(el)
  const label = formatPickLabel(name, tag)
  return {
    rect: mapIframeRect(
      { x: b.left, y: b.top, w: b.width, h: b.height },
      { x: frameBox.left, y: frameBox.top },
      { x: overlayBox.left, y: overlayBox.top },
    ),
    label,
    selector,
  }
}

function overlayHitFromMessage(
  hit: {
    rect: PickRect
    tag: string
    name?: string
    text?: string
    selector?: string
    label?: string
  },
  overlay: HTMLElement,
  frame: HTMLIFrameElement,
): OverlayHit {
  const overlayBox = overlay.getBoundingClientRect()
  const frameBox = frame.getBoundingClientRect()
  const tag = hit.tag
  const name = hit.name ?? ''
  const label = hit.label !== undefined && hit.label.length > 0 ? hit.label : formatPickLabel(name, tag)
  const selector = hit.selector ?? tag
  return {
    rect: mapIframeRect(hit.rect, { x: frameBox.left, y: frameBox.top }, { x: overlayBox.left, y: overlayBox.top }),
    label,
    selector,
  }
}

function probeHit(
  overlay: HTMLElement,
  frame: HTMLIFrameElement | null,
  clientX: number,
  clientY: number,
  seq: { current: number },
): Promise<OverlayHit | null> {
  const same = hitElement(overlay, frame, clientX, clientY)
  if (same !== null) return Promise.resolve(same)
  const target = frame
  const win = target?.contentWindow
  if (target === null || target === undefined || win === null || win === undefined) return Promise.resolve(null)
  const frameBox = target.getBoundingClientRect()
  const id = seq.current + 1
  seq.current = id
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve(null)
    }, 160)
    function onMsg(event: MessageEvent): void {
      if (event.source !== win) return
      const data = event.data as { type?: string; id?: number; hit?: OverlayHit['rect'] & Record<string, unknown> } | null
      if (data?.type !== DCS_PICK_HIT || data.id !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      if (seq.current !== id) {
        resolve(null)
        return
      }
      const payload = data.hit as {
        rect: PickRect
        tag: string
        name?: string
        text?: string
        selector?: string
        label?: string
      } | null
      if (payload == null || payload.rect === undefined) {
        resolve(null)
        return
      }
      resolve(overlayHitFromMessage(payload, overlay, target))
    }
    window.addEventListener('message', onMsg)
    win.postMessage({
      type: DCS_PICK_TYPE,
      id,
      x: clientX - frameBox.left,
      y: clientY - frameBox.top,
    }, '*')
  })
}

function finishLasso(
  overlay: HTMLElement,
  frame: HTMLIFrameElement | null,
  rect: PickRect,
  seq: { current: number },
): Promise<string[]> {
  const same = selectorsInRect(frame, overlay, rect)
  if (same.length > 0) return Promise.resolve(same)
  const win = frame?.contentWindow
  if (frame === null || win === null || win === undefined) return Promise.resolve([])
  const overlayBox = overlay.getBoundingClientRect()
  const frameBox = frame.getBoundingClientRect()
  const iframeRect = {
    x: rect.x + overlayBox.left - frameBox.left,
    y: rect.y + overlayBox.top - frameBox.top,
    w: rect.w,
    h: rect.h,
  }
  const id = seq.current + 1
  seq.current = id
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve([])
    }, 160)
    function onMsg(event: MessageEvent): void {
      if (event.source !== win) return
      const data = event.data as { type?: string; id?: number; selectors?: string[] } | null
      if (data?.type !== DCS_PICK_SCAN_HIT || data.id !== id) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      resolve(Array.isArray(data.selectors) ? data.selectors : [])
    }
    window.addEventListener('message', onMsg)
    win.postMessage({ type: DCS_PICK_SCAN, id, rect: iframeRect }, '*')
  })
}

function dataAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-')) out[attr.name] = attr.value
  }
  return out
}

function reactName(el: Element): string {
  const rec = el as unknown as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue
    let fiber: unknown = rec[key]
    while (fiber !== null && typeof fiber === 'object') {
      const node = fiber as { type?: unknown; return?: unknown }
      const name = reactTypeName(node.type)
      if (name.length > 0) return name
      fiber = node.return
    }
  }
  return ''
}

function reactTypeName(type: unknown): string {
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name: string }
    return capName(fn.displayName ?? fn.name)
  }
  if (typeof type === 'object' && type !== null) {
    const obj = type as {
      displayName?: string
      name?: string
      render?: { displayName?: string; name?: string }
    }
    return capName(obj.displayName ?? obj.name ?? obj.render?.displayName ?? obj.render?.name ?? '')
  }
  return ''
}

function capName(name: string): string {
  if (name.length === 0 || name === 'anonymous' || name === 'Fragment') return ''
  const first = name.charAt(0)
  return first === first.toUpperCase() && first !== first.toLowerCase() ? name : ''
}

function selectorsInRect(frame: HTMLIFrameElement | null, overlay: HTMLElement, rect: PickRect): string[] {
  const doc = iframeDocument(frame)
  if (doc === null || frame === null) return []
  const overlayBox = overlay.getBoundingClientRect()
  const frameBox = frame.getBoundingClientRect()
  const found: string[] = []
  const seen = new Set<string>()
  const nodes = doc.querySelectorAll('a, button, [id], h1, h2, h3, input, textarea, select, img, label')
  for (const node of nodes) {
    const b = node.getBoundingClientRect()
    if (b.width < 1 || b.height < 1) continue
    const mapped = mapIframeRect(
      { x: b.left, y: b.top, w: b.width, h: b.height },
      { x: frameBox.left, y: frameBox.top },
      { x: overlayBox.left, y: overlayBox.top },
    )
    if (!rectsIntersect(rect, mapped)) continue
    const mark = markForElement(node)
    if (seen.has(mark)) continue
    seen.add(mark)
    found.push(mark)
    if (found.length >= 6) break
  }
  return found
}
