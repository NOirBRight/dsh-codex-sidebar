/** Terminal 工具 slice. Ticket 04 owns this file. */

import type { Effect } from './session.ts'

export type TerminalIntent = never

export type TerminalState = {
  alive: boolean
}

export function emptyTerminal(): TerminalState {
  return { alive: false }
}

export function reduceTerminal(_state: TerminalState, _intent: { type: string }): { state: TerminalState; effects: Effect[] } | undefined {
  return undefined
}
