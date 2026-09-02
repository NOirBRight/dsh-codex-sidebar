import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_CSS } from '../src/client/css.ts'
import { MANAGED_BROWSER_PRESENTATION_CSS } from '../src/client/managed-browser-presentation.ts'

const source = readFileSync(new URL('../src/client/BrowserPane.tsx', import.meta.url), 'utf8')
const canvasSource = readFileSync(new URL('../src/client/ManagedBrowserCanvas.tsx', import.meta.url), 'utf8')
const browserCss = source.match(/const BROWSER_CSS = `([\s\S]*?)`/)?.[1] ?? ''

describe('managed Browser presentation CSS', () => {
  it('hides inactive video slots and gives video and Canvas identical contain geometry', () => {
    expect(source).toContain('MANAGED_BROWSER_PRESENTATION_CSS')
    expect(MANAGED_BROWSER_PRESENTATION_CSS).toMatch(/\.dcs-managed-browser-video\s*\{[^}]*opacity:\s*0/s)
    expect(MANAGED_BROWSER_PRESENTATION_CSS).toMatch(/\.dcs-managed-browser-video\[data-dcs-presenter\]\s*\{[^}]*opacity:\s*1/s)
    expect(MANAGED_BROWSER_PRESENTATION_CSS).not.toMatch(/display:\s*none/)
    expect(MANAGED_BROWSER_PRESENTATION_CSS).toMatch(/\.dcs-managed-browser-video,\s*\.dcs-managed-browser-canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*object-position:\s*center[^}]*pointer-events:\s*none/s)
  })

  it('measures fit from the official details content track while preserving the Alpha4 sidebar track', () => {
    expect(SIDEBAR_CSS).toMatch(/\[data-dcs-pin\]\s*\{[^}]*grid-template-columns:\s*var\(--dcs-sidebar-track, auto\)\s+minmax\(0, 1fr\)\s+var\(--dcs-details-track, 0px\)/s)
    expect(SIDEBAR_CSS).toMatch(/\.dcs-body\[data-fill\]\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/s)
    expect(browserCss).toMatch(/\.dcs-b-page\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*width:\s*100%[^}]*overflow:\s*hidden/s)
    expect(source).toContain('fitContainerRef={pageRef}')
    expect(canvasSource).toContain('observer?.observe(container)')
    expect(canvasSource).toContain('browserObservedContentSize(entry)')
    expect(canvasSource).not.toContain('layoutRef.current?.observeContainer({ width: bounds.width, height: bounds.height }')
  })

  it('does not let React own video hidden or canvas opacity after a WebRTC presenter commit', () => {
    const videos = [...canvasSource.matchAll(/<video[\s\S]*?\/>/g)].map((match) => match[0])
    expect(videos).toHaveLength(2)
    for (const video of videos) expect(video).not.toMatch(/\bhidden\b/)
    expect(canvasSource).not.toMatch(/style=\{\{\s*opacity:\s*1/)
    expect(canvasSource).not.toContain('useLayoutEffect')
  })

  it('forwards pointer and wheel from a surface hit layer above inert video and canvas', () => {
    expect(MANAGED_BROWSER_PRESENTATION_CSS).toMatch(/\.dcs-managed-browser-surface\s*\{[^}]*touch-action:\s*none/s)
    expect(MANAGED_BROWSER_PRESENTATION_CSS).toMatch(/\.dcs-managed-browser-input\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*z-index:\s*3[^}]*touch-action:\s*none/s)
    expect(canvasSource).toMatch(/className="dcs-managed-browser-input"[\s\S]*?onPointerDown=\{onPointerDown\}/)
    expect(canvasSource).toMatch(/className="dcs-managed-browser-input"[\s\S]*?onWheel=\{onWheel\}/)
    const canvasTag = canvasSource.match(/<canvas[\s\S]*?\/>/)?.[0] ?? ''
    expect(canvasTag).toContain('dcs-managed-browser-canvas')
    expect(canvasTag).not.toMatch(/onPointerDown|onWheel/)
  })
})
