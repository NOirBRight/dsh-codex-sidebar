/** xterm constructor options shared with the Unicode 11 addon contract test. */

export const TERMINAL_GRAPHICS_FONT = '"DCS Terminal Graphics"'

export function terminalFontFamily(hostFont: string): string {
  const themed = hostFont.trim()
  const fallback = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
  return `${TERMINAL_GRAPHICS_FONT}, ${themed.length > 0 ? themed + ', ' : ''}${fallback}`
}

export function terminalOptions(fontFamily: string) {
  return {
    // Unicode11Addon reads terminal.unicode, which xterm guards as proposed API.
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontSize: 13,
    lineHeight: 1,
    letterSpacing: 0,
    customGlyphs: true,
    // DOM renderer cannot rescale glyphs; the graphics font keeps quadrants one cell wide.
    rescaleOverlappingGlyphs: false,
    fontFamily,
  }
}
