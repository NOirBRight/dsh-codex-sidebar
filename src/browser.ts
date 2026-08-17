/** Browser 工具 slice. Ticket 03 owns this file. */

import type { Effect } from './session.ts'

export type BrowserIntent = never

export type BrowserPort = Record<string, never>

export type BrowserState = {
  url: string
}

export function emptyBrowser(): BrowserState {
  return { url: '' }
}

export function projectBrowser(state: BrowserState, _port?: BrowserPort): BrowserState {
  return { ...state }
}

export function reduceBrowser(
  _state: BrowserState,
  _intent: { type: string },
  _port?: BrowserPort,
): { state: BrowserState; effects: Effect[] } | undefined {
  return undefined
}
