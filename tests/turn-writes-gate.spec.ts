import { describe, expect, it } from 'vitest'
import { needsTurnWrites } from '../src/client/turn-writes-gate.ts'

const reviewTab = { id: 't1', kind: 'Review' as const }
const filesTab = { id: 't2', kind: 'Files' as const }

describe('needsTurnWrites', () => {
  it('ships payloads only for a visible Review tab or an intent that opens Review', () => {
    expect(needsTurnWrites(undefined)).toBe(false)
    expect(needsTurnWrites({ collapsed: true, active: 't1', tabs: [reviewTab] })).toBe(false)
    expect(needsTurnWrites({ collapsed: false, active: 't2', tabs: [reviewTab, filesTab] })).toBe(false)
    expect(needsTurnWrites({ collapsed: false, active: 't1', tabs: [reviewTab] })).toBe(true)
    expect(needsTurnWrites({ collapsed: true, active: null, tabs: [] }, { type: 'pick-tool', kind: 'Review' })).toBe(true)
    expect(needsTurnWrites({ collapsed: false, active: 't2', tabs: [reviewTab, filesTab] }, { type: 'select-tab', id: 't1' })).toBe(true)
    expect(needsTurnWrites({ collapsed: false, active: 't2', tabs: [reviewTab, filesTab] }, { type: 'select-tab', id: 't2' })).toBe(false)
    expect(needsTurnWrites({ collapsed: true, active: 't2', tabs: [filesTab] }, { type: 'review-switch' })).toBe(true)
    expect(needsTurnWrites({
      collapsed: true,
      active: 't2',
      tabs: [filesTab],
      attachments: [{ id: 'a1', source: 'review' }],
    }, { type: 'edit-attachment', id: 'a1' })).toBe(true)
    expect(needsTurnWrites({ collapsed: false, active: 't2', tabs: [filesTab] }, { type: 'open-path' })).toBe(false)
  })
})
