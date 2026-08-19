import { describe, expect, it } from 'vitest'
import { sourceForFlowKey } from '../src/client/annotation-chips.ts'

describe('sourceForFlowKey', () => {
  it('reads source from Map or record chat nodes', () => {
    const source = { kind: 'user', annotations: [{ id: 'a1' }] }
    expect(sourceForFlowKey({ chat: { nodes: new Map([['n1', { data: { source } }]]) } }, 'n1')).toEqual(source)
    expect(sourceForFlowKey({ chat: { nodes: { n1: { data: { source } } } } }, 'n1')).toEqual(source)
    expect(sourceForFlowKey({ chat: { nodes: {} } }, 'n1')).toBeUndefined()
  })
})
