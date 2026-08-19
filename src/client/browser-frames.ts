/** Persistent Browser iframe theater: attach once, then dock/park by fixed geometry. */

export const BROWSER_PARK_SIZE = { w: 960, h: 720 } as const
export const BROWSER_PARK_ORIGIN = { x: -12000, y: 0 } as const
export const BROWSER_MIN_DOCK = 8
export const BROWSER_WELL_ID = 'dcs-browser-well'

export type BrowserFrameBox = { x: number; y: number; w: number; h: number }

export type BrowserFrameSurface =
  | { mode: 'dock'; box: BrowserFrameBox; pointerEvents: 'auto' | 'none'; visibility: 'visible' | 'hidden' }
  | { mode: 'park' }

export function browserFrameKey(sessionId: string, tabId: string): string {
  return sessionId + ':' + tabId
}

export function shouldReuseFrameSrc(current: string, next: string): boolean {
  return current === next || current === next + '/' || current + '/' === next
}

export function browserFrameSurfaceStyle(surface: BrowserFrameSurface): Record<string, string> {
  const box = surface.mode === 'dock'
    ? surface.box
    : { x: BROWSER_PARK_ORIGIN.x, y: BROWSER_PARK_ORIGIN.y, w: BROWSER_PARK_SIZE.w, h: BROWSER_PARK_SIZE.h }
  return {
    position: 'fixed',
    inset: 'auto',
    left: String(box.x) + 'px',
    top: String(box.y) + 'px',
    width: String(box.w) + 'px',
    height: String(box.h) + 'px',
    border: '0px',
    background: '#fff',
    zIndex: '0',
    pointerEvents: surface.mode === 'dock' ? surface.pointerEvents : 'none',
    visibility: surface.mode === 'dock' ? surface.visibility : 'visible',
  }
}

export type BrowserFrameHost = {
  ensure(key: string, src: string, title: string): HTMLIFrameElement
  apply(key: string, surface: BrowserFrameSurface): void
  reload(key: string): void
  drop(key: string): void
  retain(keys: ReadonlySet<string>): void
  get(key: string): HTMLIFrameElement | undefined
}

export function createBrowserFrameHost(doc: Document = document): BrowserFrameHost {
  const frames = new Map<string, HTMLIFrameElement>()
  const well = ensureWell(doc)

  function remove(key: string): void {
    const frame = frames.get(key)
    if (frame === undefined) return
    frame.remove()
    frames.delete(key)
  }

  return {
    get(key) {
      return frames.get(key)
    },
    ensure(key, src, title) {
      let frame = frames.get(key)
      if (frame === undefined) {
        frame = doc.createElement('iframe')
        frame.className = 'dcs-b-frame'
        frame.dataset.dcsBrowserFrame = key
        frame.src = src
        Object.assign(frame.style, browserFrameSurfaceStyle({ mode: 'park' }))
        well.appendChild(frame)
        frames.set(key, frame)
      } else if (!shouldReuseFrameSrc(frame.src, src) && frame.getAttribute('src') !== src) {
        frame.src = src
      }
      frame.title = title
      return frame
    },
    apply(key, surface) {
      const frame = frames.get(key)
      if (frame === undefined) return
      Object.assign(frame.style, browserFrameSurfaceStyle(surface))
      if (surface.mode === 'park' && doc.activeElement === frame) frame.blur()
    },
    reload(key) {
      const frame = frames.get(key)
      if (frame === undefined) return
      const src = frame.getAttribute('src') ?? frame.src
      frame.src = src
    },
    drop(key) {
      remove(key)
    },
    retain(keys) {
      for (const key of [...frames.keys()]) {
        if (!keys.has(key)) remove(key)
      }
    },
  }
}

function ensureWell(doc: Document): HTMLElement {
  const found = doc.getElementById(BROWSER_WELL_ID)
  const well = found ?? doc.createElement('div')
  well.id = BROWSER_WELL_ID
  well.className = 'dcs-b-well'
  well.setAttribute('data-dcs-browser-theater', 'true')
  Object.assign(well.style, {
    position: 'fixed',
    inset: '0px',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '3',
  })
  if (well.parentElement === null) doc.body.appendChild(well)
  return well
}

let shared: BrowserFrameHost | undefined

export function browserFrames(): BrowserFrameHost {
  if (shared === undefined) shared = createBrowserFrameHost()
  return shared
}
