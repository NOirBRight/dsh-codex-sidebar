import { describe, expect, it } from 'vitest'
import { NOTE_GAP, NOTE_PAD, placeNotePopover } from '../src/note-place.ts'

const CHIP = { w: 248, h: 36 }
const PAGE = { x: 0, y: 48, w: 320, h: 400 }

describe('批注 composer flip/shift', () => {
  it('keeps the chip fully inside the page when the mark is on the left edge', () => {
    const pos = placeNotePopover({ x: 12, y: 120, w: 0, h: 0 }, CHIP, PAGE)
    expect(pos.x).toBeGreaterThanOrEqual(PAGE.x + NOTE_PAD)
    expect(pos.x + CHIP.w).toBeLessThanOrEqual(PAGE.x + PAGE.w - NOTE_PAD)
    expect(pos.y).toBe(120 + NOTE_GAP)
    expect(pos.x).toBe(12 + NOTE_GAP)
  })

  it('places to the left of the mark when a right-side click would clip', () => {
    const pos = placeNotePopover({ x: 310, y: 160, w: 0, h: 0 }, CHIP, PAGE)
    expect(pos.x).toBeGreaterThanOrEqual(PAGE.x + NOTE_PAD)
    expect(pos.x + CHIP.w).toBeLessThanOrEqual(PAGE.x + PAGE.w - NOTE_PAD)
    expect(pos.x + CHIP.w).toBeLessThanOrEqual(310 - NOTE_GAP)
  })

  it('flips above when below the mark would clip the bottom edge', () => {
    const pos = placeNotePopover({ x: 160, y: 420, w: 40, h: 20 }, CHIP, PAGE)
    expect(pos.y + CHIP.h).toBeLessThanOrEqual(420 - NOTE_GAP)
    expect(pos.y).toBeGreaterThanOrEqual(PAGE.y + NOTE_PAD)
    expect(pos.x).toBeGreaterThanOrEqual(PAGE.x + NOTE_PAD)
    expect(pos.x + CHIP.w).toBeLessThanOrEqual(PAGE.x + PAGE.w - NOTE_PAD)
  })

  it('clamps into a pane narrower than the chip so no character hangs off', () => {
    const narrow = { x: 0, y: 0, w: 200, h: 180 }
    const pos = placeNotePopover({ x: 8, y: 10, w: 0, h: 0 }, CHIP, narrow)
    const innerW = narrow.w - NOTE_PAD * 2
    expect(pos.x).toBe(NOTE_PAD)
    expect(pos.y).toBeGreaterThanOrEqual(NOTE_PAD)
    expect(pos.x + innerW).toBeLessThanOrEqual(narrow.w - NOTE_PAD)
  })

  it('centers below a mid-page mark when everything fits', () => {
    const pos = placeNotePopover({ x: 140, y: 140, w: 40, h: 24 }, CHIP, PAGE)
    expect(pos.x).toBe(140 + 20 - CHIP.w / 2)
    expect(pos.y).toBe(140 + 24 + NOTE_GAP)
  })
})
