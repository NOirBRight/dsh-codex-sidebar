/** details slot occupancy: shadow the shipped DetailsPanel (priority 0). */

export const DETAILS_SLOT = 'details'
export const DETAILS_PRIORITY = -100
export const DEFAULT_DETAILS_PRIORITY = 0

/** Every service read through ClientContext must be injected; otherwise its proxy throws at runtime. */
export const CLIENT_INJECT = ['slots', 'locale', 'connection', 'layout', 'sessions', 'workspaces', 'remote'] as const

type DetailsSlots = {
  inject(key: typeof DETAILS_SLOT, callback: () => void): unknown
  register(options: { name: typeof DETAILS_SLOT; locale: string; priority: number; inject: () => object }, component: unknown): unknown
}

export function shadowsDefaultDetails(priority: number): boolean {
  return priority < DEFAULT_DETAILS_PRIORITY
}

/** AppFrame owns the details track (`details: 0` closed). CSS vars do not open it. */
export function detailsTrackShouldOpen(collapsed: boolean | undefined): boolean {
  return collapsed === false
}

export function applyDetailsTrack(
  layout: { openDetails(): void; closeDetails(): void },
  collapsed: boolean | undefined,
): void {
  if (detailsTrackShouldOpen(collapsed)) layout.openDetails()
  else layout.closeDetails()
}

export function occupyDetails(
  slotsValue: unknown,
  face: () => object,
  panel: unknown,
  locale: string,
): void {
  const slots = slotsValue as DetailsSlots
  const register = slots.register.bind(slots)
  slots.inject(DETAILS_SLOT, () => {
    register({
      name: DETAILS_SLOT,
      locale,
      priority: DETAILS_PRIORITY,
      inject: face,
    }, panel)
  })
}
