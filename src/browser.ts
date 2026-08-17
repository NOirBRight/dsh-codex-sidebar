/** Browser 工具 slice. Ticket 03 owns this file. */

export type BrowserIntent = never

export type BrowserState = {
  url: string
}

export function emptyBrowser(): BrowserState {
  return { url: '' }
}

export function reduceBrowser(_state: BrowserState, _intent: { type: string }): BrowserState | undefined {
  return undefined
}
