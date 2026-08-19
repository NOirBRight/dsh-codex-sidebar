import { describe, expect, it } from 'vitest'
import { tabAuxIntent } from '../src/tab-events.ts'

describe('Tab mouse buttons', () => {
  it('closes a Tab only for the middle mouse button', () => {
    expect(tabAuxIntent(1, 'tab-a')).toEqual({ type: 'close-tab', id: 'tab-a' })
    expect(tabAuxIntent(0, 'tab-a')).toBeUndefined()
    expect(tabAuxIntent(2, 'tab-a')).toBeUndefined()
  })
})
