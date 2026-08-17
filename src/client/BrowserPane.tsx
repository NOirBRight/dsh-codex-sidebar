/** Browser 工具: URL chrome, empty / unreachable / loaded page, 批注 at the mark. */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { Ico } from './icons.tsx'

const BROWSER_CSS = `
.dcs-browser { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; position: relative; }
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
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-base);
}
.dcs-b-empty h2 {
  margin: 10px 0 0; font-size: 17px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); letter-spacing: -0.02em;
}
.dcs-b-empty p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.dcs-b-page {
  flex: 1; background: var(--dsw-alias-bg-base); position: relative; min-height: 0;
}
.dcs-b-frame { width: 100%; height: 100%; border: 0; background: #fff; }
.dcs-b-mask {
  position: absolute; inset: 0; z-index: 2; cursor: crosshair; background: transparent;
}
.dcs-b-page[data-mark] { cursor: crosshair; }
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
  if (document.getElementById('dsh-codex-sidebar-browser-css')) return
  const style = document.createElement('style')
  style.id = 'dsh-codex-sidebar-browser-css'
  style.textContent = BROWSER_CSS
  document.head.appendChild(style)
}

export function BrowserPane({
  snapshot,
  onIntent,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
}): ReactElement {
  ensureBrowserStyles()
  const browser = snapshot.browser
  const bodyRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(browser.draft)
  const hasPage = browser.url.trim().length > 0

  useEffect(() => {
    setDraft(browser.draft)
  }, [browser.draft])

  function submitUrl(event: FormEvent): void {
    event.preventDefault()
    onIntent({ type: 'open-url', url: draft })
  }

  function onNoteKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onIntent({ type: 'browser-dismiss-note' })
      return
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      onIntent({ type: 'browser-note-ctrl-enter' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onIntent({ type: 'browser-note-enter' })
    }
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
          onClick={() => { onIntent({ type: 'browser-refresh' }) }}
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
            onClick={() => {
              if (!hasPage) return
              onIntent({ type: 'browser-open-external' })
              window.open(browser.url, '_blank', 'noopener')
            }}
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
          <h2>Start browsing</h2>
          <p>Enter a URL to open a page</p>
        </div>
      )}
      {browser.status === 'unreachable' && (
        <div className="dcs-b-empty">
          <Ico name="globe" size={40} />
          <h2>Unable to connect</h2>
          <p>侧栏不起项目</p>
        </div>
      )}
      {browser.status === 'loaded' && browser.url.length > 0 && (
        <div className="dcs-b-page" data-mark={browser.annotate || undefined}>
          <iframe
            className="dcs-b-frame"
            title={browser.page?.title ?? browser.url}
            src={browser.url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
          {browser.annotate && (
            <div
              className="dcs-b-mask"
              onClick={(event) => {
                const pane = bodyRef.current
                if (pane === null) return
                const box = pane.getBoundingClientRect()
                const x = event.clientX - box.left
                const y = event.clientY - box.top
                onIntent({
                  type: 'browser-click-content',
                  mark: `${browser.url}@${Math.round(x)},${Math.round(y)}`,
                  x,
                  y,
                })
              }}
            />
          )}
        </div>
      )}
      {browser.pendingMark !== null && browser.notePos !== null && (
        <div className="dcs-note" style={{ left: browser.notePos.x, top: browser.notePos.y + 12 }}>
          <input
            autoFocus
            value={browser.noteDraft}
            placeholder="批注给舵主"
            onChange={(event) => { onIntent({ type: 'browser-set-note-draft', text: event.target.value }) }}
            onKeyDown={onNoteKey}
          />
        </div>
      )}
    </div>
  )
}
