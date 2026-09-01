import { describe, expect, it } from 'vitest'
import { ALPHA1_REVISION, ALPHA1_TAG, assessAlpha1Checkout } from '../scripts/prepare-alpha1-types.mjs'

const clean = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  status: '',
  head: ALPHA1_REVISION,
  tag: ALPHA1_TAG,
}

describe('Alpha1 type checkout validation', () => {
  it('accepts only the clean official pinned revision with built declarations', () => {
    expect(assessAlpha1Checkout(clean)).toEqual({ ok: true })
  })

  it.each([
    [{ ...clean, remote: 'https://github.com/example/deepseek-harness.git' }, 'origin is not'],
    [{ ...clean, status: ' M package.json' }, 'local changes'],
    [{ ...clean, head: 'deadbeef' }, 'not ' + ALPHA1_REVISION],
    [{ ...clean, tag: 'dsh-v0.1.2-alpha.2' }, 'tag is not'],
    [{ ...clean, missingTypes: ['packages/client/store/lib/types/index.d.ts'] }, 'declarations are missing'],
  ])('rejects an incompatible checkout', (checkout, reason) => {
    const result = assessAlpha1Checkout(checkout)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reasons: expect.arrayContaining([expect.stringContaining(reason)]) })
  })
})
