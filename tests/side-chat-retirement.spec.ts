import { describe, expect, it } from 'vitest'

import { PALETTE, retireSideChatTabs, type Tab } from '../src/session.ts'

describe('Side Chat retirement seam', () => {
  it('removes Side Chat from the palette and repairs an active legacy tab', () => {
    const legacy = [
      { id: 't1', kind: 'Side Chat', target: '', title: 'Side Chat' },
      { id: 't2', kind: 'Files', target: 'src/a.ts', title: 'a.ts' },
    ] as unknown as Tab[]

    expect(PALETTE).toEqual(['Review', 'Terminal', 'Browser', 'Files'])
    expect(retireSideChatTabs(legacy, 't1')).toEqual({ tabs: [legacy[1]], active: 't2' })
  })
})
