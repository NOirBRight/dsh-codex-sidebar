/** Select every mounted Browser surface and mark only the active Tab as interactive. */

import type { Tab } from '../session.ts'

export type BrowserSurfaceOccupant = {
  tabId: string
  active: boolean
}

/** Keep Browser surfaces mounted across tool Tab switches without retaining closed Tabs. */
export function browserSurfaceOccupants(
  tabs: ReadonlyArray<Pick<Tab, 'id' | 'kind'>>,
  activeTabId: string | null,
): BrowserSurfaceOccupant[] {
  return tabs.flatMap((tab) => tab.kind === 'Browser'
    ? [{ tabId: tab.id, active: tab.id === activeTabId }]
    : [])
}
