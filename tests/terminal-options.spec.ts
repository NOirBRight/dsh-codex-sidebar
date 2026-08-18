import { describe, expect, it } from 'vitest'
import { SIDEBAR_CSS } from '../src/client/css.ts'
import { terminalFontFamily, terminalOptions } from '../src/client/terminal-options.ts'

describe('xterm Unicode 11 contract', () => {
  it('enables proposed API before Unicode11Addon is loaded', () => {
    const options = terminalOptions('Test Mono')
    expect(options.allowProposedApi).toBe(true)
    expect(options.fontFamily).toBe('Test Mono')
  })

  it('renders Claude quadrant glyphs with a one-cell graphics font', () => {
    const stack = terminalFontFamily('Theme Mono')
    expect(stack.startsWith('"DCS Terminal Graphics", Theme Mono')).toBe(true)
    expect(terminalOptions(stack).rescaleOverlappingGlyphs).toBe(false)
    expect(SIDEBAR_CSS).toContain("font-family: 'DCS Terminal Graphics'")
    expect(SIDEBAR_CSS).toContain("local('Noto Sans Mono'), local('DejaVu Sans Mono')")
    expect(SIDEBAR_CSS).toContain('U+2500-259F')
  })
})
