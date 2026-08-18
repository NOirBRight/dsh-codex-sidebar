/** details slot occupancy: shadow the shipped DetailsPanel (priority 0). */

export const DETAILS_SLOT = 'details'
export const DETAILS_PRIORITY = -100
export const DEFAULT_DETAILS_PRIORITY = 0

/** Every service read through ClientContext must be injected; otherwise its proxy throws at runtime. */
export const CLIENT_INJECT = ['slots', 'locale', 'connection', 'layout', 'sessions', 'workspaces'] as const

export type DetailsSlots = {
  inject: (key: string, callback: () => void) => unknown
  register: (options: { name: string; locale: string; priority: number; inject: unknown }, component: unknown) => unknown
}

export function shadowsDefaultDetails(priority: number): boolean {
  return priority < DEFAULT_DETAILS_PRIORITY
}

/** AppFrame owns the details track (`details: 0` closed). CSS vars do not open it. */
export function detailsTrackShouldOpen(collapsed: boolean): boolean {
  return collapsed === false
}

export function applyDetailsTrack(
  layout: { openDetails(): void; closeDetails(): void },
  collapsed: boolean,
): void {
  if (detailsTrackShouldOpen(collapsed)) layout.openDetails()
  else layout.closeDetails()
}

export function occupyDetails(
  slots: DetailsSlots,
  face: unknown,
  panel: unknown,
  locale: string,
): void {
  slots.inject(DETAILS_SLOT, () => {
    slots.register({
      name: DETAILS_SLOT,
      locale,
      priority: DETAILS_PRIORITY,
      inject: face,
    }, panel)
  })
}
