/** Terminal 工具 slice. Ticket 04 owns this file. */

export type TerminalIntent = never

export type TerminalState = {
  alive: boolean
}

export function emptyTerminal(): TerminalState {
  return { alive: false }
}

export function reduceTerminal(_state: TerminalState, _intent: { type: string }): TerminalState | undefined {
  return undefined
}
