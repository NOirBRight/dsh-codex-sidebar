/** Terminal 工具 slice: the human's pty, not the 舵主's command tool. */

import type { Effect } from './session.ts'

export type TerminalIntent =
  | { type: 'terminal-open'; tabId: string }
  | { type: 'terminal-write'; tabId: string; bytes: string }
  | { type: 'terminal-destroy'; tabId: string }

export type TerminalPort = {
  cwd(): string
  create(tabId: string, cwd: string, token?: string): string
  write(tabId: string, bytes: string): void
  destroy(tabId: string): void
  read(tabId: string): string
}

export type TerminalPty = {
  cwd: string
  output: string
  token: string
}

export type TerminalState = {
  byTab: Record<string, TerminalPty>
}

export function emptyTerminal(): TerminalState {
  return { byTab: {} }
}

export function projectTerminal(state: TerminalState, port?: TerminalPort): TerminalState {
  const byTab: Record<string, TerminalPty> = {}
  for (const [tabId, rec] of Object.entries(state.byTab ?? {})) {
    const token = rec.token ?? tabId
    byTab[tabId] = {
      cwd: rec.cwd,
      token,
      output: port === undefined ? rec.output : port.read(tabId),
    }
  }
  return { byTab }
}

export function reduceTerminal(
  state: TerminalState,
  intent: { type: string },
  port?: TerminalPort,
): { state: TerminalState; effects: Effect[] } | undefined {
  const typed = asTerminal(intent)
  if (typed === undefined) return undefined
  const byTab: Record<string, TerminalPty> = { ...state.byTab }
  switch (typed.type) {
    case 'terminal-open': {
      const cwd = port === undefined ? '' : port.cwd()
      const held = byTab[typed.tabId]?.token
      const token = port === undefined ? held ?? typed.tabId : port.create(typed.tabId, cwd, held)
      const output = port === undefined ? '' : port.read(typed.tabId)
      byTab[typed.tabId] = { cwd, output, token }
      return { state: { byTab }, effects: [] }
    }
    case 'terminal-write': {
      if (byTab[typed.tabId] === undefined) return { state: { byTab }, effects: [] }
      port?.write(typed.tabId, typed.bytes)
      const rec = byTab[typed.tabId]
      byTab[typed.tabId] = {
        cwd: rec?.cwd ?? '',
        output: port === undefined ? `${rec?.output ?? ''}${typed.bytes}` : port.read(typed.tabId),
        token: rec?.token ?? typed.tabId,
      }
      return { state: { byTab }, effects: [] }
    }
    case 'terminal-destroy': {
      if (byTab[typed.tabId] === undefined) return { state: { byTab }, effects: [] }
      port?.destroy(typed.tabId)
      delete byTab[typed.tabId]
      return { state: { byTab }, effects: [] }
    }
  }
}

function asTerminal(intent: { type: string }): TerminalIntent | undefined {
  if (intent.type !== 'terminal-open' && intent.type !== 'terminal-write' && intent.type !== 'terminal-destroy') {
    return undefined
  }
  return intent as TerminalIntent
}
