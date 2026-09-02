import { describe, expect, it } from 'vitest'
import { ALPHA4_REVISION, ALPHA4_TAG, assessAlpha4Checkout } from '../scripts/prepare-alpha4-types.mjs'

const clean = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  status: '',
  head: ALPHA4_REVISION,
  tag: ALPHA4_TAG,
}

describe('Alpha4 type checkout validation', () => {
  it('accepts only the clean official pinned revision with built declarations', () => {
    expect(assessAlpha4Checkout(clean)).toEqual({ ok: true })
  })

  it.each([
    [{ ...clean, remote: 'https://github.com/example/deepseek-harness.git' }, 'origin is not'],
    [{ ...clean, status: ' M package.json' }, 'local changes'],
    [{ ...clean, head: 'deadbeef' }, 'not ' + ALPHA4_REVISION],
    [{ ...clean, tag: 'dsh-v0.1.2-alpha.2' }, 'tag is not'],
    [{ ...clean, missingTypes: ['packages/client/store/lib/types/index.d.ts'] }, 'declarations are missing'],
  ])('rejects an incompatible checkout', (checkout, reason) => {
    const result = assessAlpha4Checkout(checkout)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reasons: expect.arrayContaining([expect.stringContaining(reason)]) })
  })
})
