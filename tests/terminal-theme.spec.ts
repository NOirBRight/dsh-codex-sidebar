import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readTerminalTheme, TERMINAL_THEME_VARS } from '../src/client/terminal-theme.ts'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../src/client/css.ts')
const css = readFileSync(cssPath, 'utf8')

describe('Terminal theme follows DSH tokens', () => {
  it('exposes every xterm slot as a --dcs-term-* var', () => {
    for (const name of Object.values(TERMINAL_THEME_VARS)) {
      expect(name.startsWith('--dcs-term-')).toBe(true)
      expect(css.includes(name + ':')).toBe(true)
    }
  })

  it('defines those vars only in terms of --dsw-alias tokens', () => {
    const block = css.slice(css.indexOf('.dcs-term {'), css.indexOf('.dcs-term .xterm'))
    expect(block.includes('#')).toBe(false)
    expect(block.includes('rgb(')).toBe(false)
    const aliases = [...block.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map((m) => m[1])
    expect(aliases.length).toBeGreaterThan(8)
    expect(aliases.every((name) => name.startsWith('--dsw-alias-'))).toBe(true)
  })

  it('reads computed vars into the xterm theme object', () => {
    const vars: Record<string, string> = {
      '--dcs-term-bg': 'bg',
      '--dcs-term-fg': 'fg',
      '--dcs-term-cursor': 'cur',
      '--dcs-term-cursor-accent': 'acc',
      '--dcs-term-selection': 'sel',
      '--dcs-term-black': 'k',
      '--dcs-term-red': 'r',
      '--dcs-term-green': 'g',
      '--dcs-term-yellow': 'y',
      '--dcs-term-blue': 'b',
      '--dcs-term-magenta': 'm',
      '--dcs-term-cyan': 'c',
      '--dcs-term-white': 'w',
      '--dcs-term-bright-black': 'bk',
      '--dcs-term-bright-red': 'br',
      '--dcs-term-bright-green': 'bg2',
      '--dcs-term-bright-yellow': 'by',
      '--dcs-term-bright-blue': 'bb',
      '--dcs-term-bright-magenta': 'bm',
      '--dcs-term-bright-cyan': 'bc',
      '--dcs-term-bright-white': 'bw',
    }
    const theme = readTerminalTheme({} as Element, (name) => vars[name] ?? '')
    expect(theme.background).toBe('bg')
    expect(theme.yellow).toBe('y')
    expect(theme.brightYellow).toBe('by')
    expect(theme.magenta).toBe('m')
  })
})
