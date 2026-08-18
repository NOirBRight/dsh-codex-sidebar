/**
 * 侧栏 width. Host AppFrame clamps details at DETAILS_MAX=520 in JS; we still
 * squeeze a third grid track via CSS variables, capped at min(70vw, 960px).
 */

export const DRAWER_MIN = 320
export const DRAWER_MAX = 960
export const DRAWER_DEFAULT = 560
export const DRAWER_VW = 0.7
export const DRAWER_STORAGE_KEY = 'dsh-codex-sidebar.drawer-width'

export type DrawerWidthStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const listeners = new Set<(px: number) => void>()
let published: number | undefined

export function clampDrawerWidth(px: number, viewport: number): number {
  const view = Math.max(0, Math.round(viewport))
  const cap = Math.min(DRAWER_MAX, Math.round(view * DRAWER_VW), view)
  const floor = Math.min(DRAWER_MIN, cap)
  const raw = Number.isFinite(px) ? Math.round(px) : DRAWER_DEFAULT
  return Math.min(cap, Math.max(floor, raw))
}

export function readDrawerWidth(store: DrawerWidthStore | undefined, viewport: number): number {
  const raw = store?.getItem(DRAWER_STORAGE_KEY)
  const n = raw === undefined || raw === null || raw === '' ? DRAWER_DEFAULT : Number(raw)
  return clampDrawerWidth(Number.isFinite(n) ? n : DRAWER_DEFAULT, viewport)
}

export function writeDrawerWidth(
  store: DrawerWidthStore | undefined,
  px: number,
  viewport: number,
): number {
  const next = clampDrawerWidth(px, viewport)
  try {
    store?.setItem(DRAWER_STORAGE_KEY, String(next))
  } catch {
    // private mode / quota
  }
  return next
}

export function browserDrawerStore(): DrawerWidthStore | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
  } catch {
    return undefined
  }
}

export function peekDrawerWidth(viewport: number): number {
  if (published !== undefined) return clampDrawerWidth(published, viewport)
  return readDrawerWidth(browserDrawerStore(), viewport)
}

export function publishDrawerWidth(px: number, viewport: number): number {
  published = writeDrawerWidth(browserDrawerStore(), px, viewport)
  for (const listener of listeners) listener(published)
  return published
}

export function subscribeDrawerWidth(listener: (px: number) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
