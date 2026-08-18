import { describe, expect, it } from 'vitest'
import { isImeKey } from '../src/ime-key.ts'

describe('IME keys', () => {
  it('treats composing and keyCode 229 as IME keys', () => {
    expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})
