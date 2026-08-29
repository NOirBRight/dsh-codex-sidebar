import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_CSS } from '../src/client/css.ts'

const source = readFileSync(new URL('../src/client/BrowserPane.tsx', import.meta.url), 'utf8')
const canvasSource = readFileSync(new URL('../src/client/ManagedBrowserCanvas.tsx', import.meta.url), 'utf8')
const browserCss = source.match(/const BROWSER_CSS = `([\s\S]*?)`/)?.[1] ?? ''

describe('managed Browser presentation CSS', () => {
  it('hides inactive video slots and gives video and Canvas identical contain geometry', () => {
    expect(browserCss).toMatch(/\.dcs-managed-browser-video\[hidden\]\s*\{[^}]*display:\s*none\s*!important[^}]*\}/s)
    expect(browserCss).toMatch(/\.dcs-managed-browser-video,\s*\.dcs-managed-browser-canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*object-position:\s*center[^}]*\}/s)
  })

  it('measures fit from the official details content track while preserving the Alpha1 sidebar track', () => {
    expect(SIDEBAR_CSS).toMatch(/\[data-dcs-pin\]\s*\{[^}]*grid-template-columns:\s*var\(--dcs-sidebar-track, auto\)\s+minmax\(0, 1fr\)\s+var\(--dcs-details-track, 0px\)/s)
    expect(SIDEBAR_CSS).toMatch(/\.dcs-body\[data-fill\]\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/s)
    expect(browserCss).toMatch(/\.dcs-b-page\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*width:\s*100%[^}]*overflow:\s*hidden/s)
    expect(source).toContain('fitContainerRef={pageRef}')
    expect(canvasSource).toContain('observer?.observe(container)')
    expect(canvasSource).toContain('browserObservedContentSize(entry)')
    expect(canvasSource).not.toContain('layoutRef.current?.observeContainer({ width: bounds.width, height: bounds.height }')
  })
})
