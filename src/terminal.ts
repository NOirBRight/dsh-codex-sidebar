/** Terminal 工具 slice: the human's pty, not the 舵主's command tool. */

import type { Effect } from './session.ts'

export type TerminalSize = { cols: number; rows: number }

export type TerminalIntent =
  | { type: 'terminal-open'; tabId: string; cols?: number; rows?: number }
  | { type: 'terminal-write'; tabId: string; bytes: string }
  | { type: 'terminal-refresh'; tabId: string; since?: number }
  | { type: 'terminal-resize'; tabId: string; cols: number; rows: number }
  | { type: 'terminal-destroy'; tabId: string }

export type TerminalPull = {
  seq: number
  chunk: string
}

export type TerminalPort = {
  cwd(): string
  create(tabId: string, cwd: string, token?: string, size?: TerminalSize): string
  write(tabId: string, bytes: string): void
  destroy(tabId: string): void
  read(tabId: string): string
  resize?(tabId: string, cols: number, rows: number): void
  pull?(tabId: string, since: number): TerminalPull
}

export type TerminalPty = {
  cwd: string
  output: string
  token: string
  seq: number
  chunk: string
}

export type TerminalState = {
  byTab: Record<string, TerminalPty>
}

/** Last N bytes kept in the live pty ring. TUI redraw storms must not freeze the host. */
export const TERMINAL_OUTPUT_CAP = 256_000

export function clipTerminalOutput(output: string): string {
  if (output.length <= TERMINAL_OUTPUT_CAP) return output
  return output.slice(output.length - TERMINAL_OUTPUT_CAP)
}

export function emptyTerminal(): TerminalState {
  return { byTab: {} }
}

export function projectTerminal(state: TerminalState): TerminalState {
  const byTab: Record<string, TerminalPty> = {}
  for (const [tabId, rec] of Object.entries(state.byTab ?? {})) {
    byTab[tabId] = {
      cwd: rec.cwd,
      token: rec.token ?? tabId,
      output: rec.output ?? '',
      seq: rec.seq ?? 0,
      chunk: rec.chunk ?? '',
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
      const size = typed.cols !== undefined && typed.rows !== undefined
        ? { cols: typed.cols, rows: typed.rows }
        : undefined
      const token = port === undefined ? held ?? typed.tabId : port.create(typed.tabId, cwd, held, size)
      byTab[typed.tabId] = sync(typed.tabId, {
        cwd,
        token,
        output: '',
        seq: 0,
        chunk: '',
      }, port, 0)
      return { state: { byTab }, effects: [] }
    }
    case 'terminal-write': {
      if (byTab[typed.tabId] === undefined) return { state: { byTab }, effects: [] }
      port?.write(typed.tabId, typed.bytes)
      byTab[typed.tabId] = sync(typed.tabId, byTab[typed.tabId], port, undefined)
      return { state: { byTab }, effects: [] }
    }
    case 'terminal-refresh': {
      if (byTab[typed.tabId] === undefined) return { state: { byTab }, effects: [] }
      byTab[typed.tabId] = sync(typed.tabId, byTab[typed.tabId], port, typed.since)
      return { state: { byTab }, effects: [] }
    }
    case 'terminal-resize': {
      if (byTab[typed.tabId] === undefined) return { state: { byTab }, effects: [] }
      port?.resize?.(typed.tabId, typed.cols, typed.rows)
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

function sync(
  tabId: string,
  rec: TerminalPty | undefined,
  port: TerminalPort | undefined,
  since: number | undefined,
): TerminalPty {
  const base: TerminalPty = {
    cwd: rec?.cwd ?? '',
    token: rec?.token ?? tabId,
    output: rec?.output ?? '',
    seq: rec?.seq ?? 0,
    chunk: rec?.chunk ?? '',
  }
  if (port === undefined) return base
  if (port.pull !== undefined && since !== undefined) {
    const pulled = port.pull(tabId, since)
    return { ...base, seq: pulled.seq, chunk: pulled.chunk, output: '' }
  }
  const output = clipTerminalOutput(port.read(tabId))
  return { ...base, output, seq: output.length, chunk: '' }
}

function asTerminal(intent: { type: string }): TerminalIntent | undefined {
  if (
    intent.type !== 'terminal-open'
    && intent.type !== 'terminal-write'
    && intent.type !== 'terminal-refresh'
    && intent.type !== 'terminal-resize'
    && intent.type !== 'terminal-destroy'
  ) {
    return undefined
  }
  return intent as TerminalIntent
}
