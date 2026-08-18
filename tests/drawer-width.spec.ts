import { describe, expect, it } from 'vitest'
import {
  clampDrawerWidth,
  DRAWER_DEFAULT,
  DRAWER_MAX,
  DRAWER_MIN,
  DRAWER_STORAGE_KEY,
  readDrawerWidth,
  writeDrawerWidth,
  type DrawerWidthStore,
} from '../src/client/drawer-width.ts'

function memoryStore(seed?: string): DrawerWidthStore & { dump(): string | null } {
  let value: string | null = seed ?? null
  return {
    getItem(key) {
      return key === DRAWER_STORAGE_KEY ? value : null
    },
    setItem(key, next) {
      if (key === DRAWER_STORAGE_KEY) value = next
    },
    dump: () => value,
  }
}

describe('overlay drawer width', () => {
  it('lets a desktop drag pass half the frame, up to min(70vw, 960)', () => {
    expect(clampDrawerWidth(800, 1440)).toBe(800)
    expect(clampDrawerWidth(800, 1440)).toBeGreaterThan(1440 / 2)
    expect(clampDrawerWidth(1100, 1440)).toBe(DRAWER_MAX)
    expect(clampDrawerWidth(1100, 1440)).toBeGreaterThan(1440 / 2)
    expect(clampDrawerWidth(1200, 1920)).toBe(DRAWER_MAX)
    expect(clampDrawerWidth(1200, 1920)).toBeGreaterThanOrEqual(1920 / 2)
    expect(clampDrawerWidth(900, 1600)).toBe(900)
    expect(clampDrawerWidth(1100, 1600)).toBe(DRAWER_MAX)
    expect(clampDrawerWidth(720, 700)).toBe(490)
  })

  it('floors at 320 unless the frame itself is narrower', () => {
    expect(clampDrawerWidth(200, 1280)).toBe(DRAWER_MIN)
    expect(clampDrawerWidth(200, 300)).toBe(210)
  })

  it('defaults to 560 and persists a drag across reloads', () => {
    const store = memoryStore()
    expect(readDrawerWidth(undefined, 1280)).toBe(DRAWER_DEFAULT)
    expect(readDrawerWidth(store, 1280)).toBe(DRAWER_DEFAULT)
    expect(writeDrawerWidth(store, 720, 1280)).toBe(720)
    expect(store.dump()).toBe('720')
    expect(readDrawerWidth(store, 1280)).toBe(720)
  })

  it('re-clamps a stored width when the viewport shrinks', () => {
    const store = memoryStore('800')
    expect(readDrawerWidth(store, 600)).toBe(420)
  })
})
