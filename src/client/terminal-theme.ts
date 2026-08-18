/** Map DSH theme tokens onto an xterm ITheme. No hex — computed vars only. */

export type TerminalXtermTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** CSS custom properties defined on .dcs-term, each aliasing a DSH token. */
export const TERMINAL_THEME_VARS = {
  background: '--dcs-term-bg',
  foreground: '--dcs-term-fg',
  cursor: '--dcs-term-cursor',
  cursorAccent: '--dcs-term-cursor-accent',
  selectionBackground: '--dcs-term-selection',
  black: '--dcs-term-black',
  red: '--dcs-term-red',
  green: '--dcs-term-green',
  yellow: '--dcs-term-yellow',
  blue: '--dcs-term-blue',
  magenta: '--dcs-term-magenta',
  cyan: '--dcs-term-cyan',
  white: '--dcs-term-white',
  brightBlack: '--dcs-term-bright-black',
  brightRed: '--dcs-term-bright-red',
  brightGreen: '--dcs-term-bright-green',
  brightYellow: '--dcs-term-bright-yellow',
  brightBlue: '--dcs-term-bright-blue',
  brightMagenta: '--dcs-term-bright-magenta',
  brightCyan: '--dcs-term-bright-cyan',
  brightWhite: '--dcs-term-bright-white',
} as const satisfies Record<keyof TerminalXtermTheme, string>

export function readTerminalTheme(el: Element, readVar?: (name: string) => string): TerminalXtermTheme {
  const read = readVar ?? ((name: string): string => {
    return getComputedStyle(el).getPropertyValue(name).trim()
  })
  const theme = {} as TerminalXtermTheme
  for (const key of Object.keys(TERMINAL_THEME_VARS) as Array<keyof TerminalXtermTheme>) {
    theme[key] = read(TERMINAL_THEME_VARS[key])
  }
  return theme
}

export function watchTerminalTheme(el: Element, apply: (theme: TerminalXtermTheme) => void): () => void {
  const push = (): void => { apply(readTerminalTheme(el)) }
  push()
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(push)
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined
  mq?.addEventListener('change', push)
  return () => {
    obs.disconnect()
    mq?.removeEventListener('change', push)
  }
}
