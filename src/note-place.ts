/** Flip/shift a floating 批注 chip so every character stays inside the pane. */

export const NOTE_PAD = 8
export const NOTE_GAP = 12
export const NOTE_ESTIMATE = { w: 248, h: 38 }

export type PlaceBox = {
  x: number
  y: number
  w: number
  h: number
}

export function placeNotePopover(
  anchor: PlaceBox,
  popover: { w: number; h: number },
  view: PlaceBox,
  pad = NOTE_PAD,
  gap = NOTE_GAP,
): { x: number; y: number } {
  const inner = {
    x: view.x + pad,
    y: view.y + pad,
    w: Math.max(0, view.w - pad * 2),
    h: Math.max(0, view.h - pad * 2),
  }
  const pw = Math.min(Math.max(0, popover.w), inner.w)
  const ph = Math.min(Math.max(0, popover.h), inner.h)
  const rightOf = anchor.x + anchor.w + gap
  const leftOf = anchor.x - gap - pw
  const centered = anchor.x + anchor.w / 2 - pw / 2
  const x = pickX(centered, rightOf, leftOf, inner.x, inner.w, pw)

  const below = anchor.y + anchor.h + gap
  const above = anchor.y - gap - ph
  let y = below
  if (below + ph > inner.y + inner.h && above >= inner.y) y = above
  y = clamp(y, inner.y, inner.y + inner.h - ph)
  return { x, y }
}

function pickX(
  centered: number,
  rightOf: number,
  leftOf: number,
  innerX: number,
  innerW: number,
  pw: number,
): number {
  if (fitsX(centered, innerX, innerW, pw)) return centered
  if (centered < innerX && fitsX(rightOf, innerX, innerW, pw)) return rightOf
  if (centered + pw > innerX + innerW && fitsX(leftOf, innerX, innerW, pw)) return leftOf
  return clamp(centered, innerX, innerX + innerW - pw)
}

function fitsX(x: number, innerX: number, innerW: number, pw: number): boolean {
  return x >= innerX && x + pw <= innerX + innerW
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(n, min), max)
}
