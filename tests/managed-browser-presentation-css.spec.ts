import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/BrowserPane.tsx', import.meta.url), 'utf8')
const browserCss = source.match(/const BROWSER_CSS = `([\s\S]*?)`/)?.[1] ?? ''

describe('managed Browser presentation CSS', () => {
  it('hides inactive video slots and gives video and Canvas identical contain geometry', () => {
    expect(browserCss).toMatch(/\.dcs-managed-browser-video\[hidden\]\s*\{[^}]*display:\s*none\s*!important[^}]*\}/s)
    expect(browserCss).toMatch(/\.dcs-managed-browser-video,\s*\.dcs-managed-browser-canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain[^}]*object-position:\s*center[^}]*\}/s)
  })
})
