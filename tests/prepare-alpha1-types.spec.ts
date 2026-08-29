import { describe, expect, it } from 'vitest'
import { ALPHA1_REVISION, assessAlpha1Checkout } from '../scripts/prepare-alpha1-types.mjs'

const clean = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  status: '',
  head: ALPHA1_REVISION,
}

describe('Alpha1 type checkout validation', () => {
  it('accepts only the clean official pinned revision with built declarations', () => {
    expect(assessAlpha1Checkout(clean)).toEqual({ ok: true })
  })

  it.each([
    [{ ...clean, remote: 'https://github.com/example/deepseek-harness.git' }, 'origin is not'],
    [{ ...clean, status: ' M package.json' }, 'local changes'],
    [{ ...clean, head: 'deadbeef' }, 'not dsh-v0.1.2-alpha.1'],
    [{ ...clean, missingTypes: ['packages/client/store/lib/types/index.d.ts'] }, 'declarations are missing'],
  ])('rejects an incompatible checkout', (checkout, reason) => {
    const result = assessAlpha1Checkout(checkout)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reasons: expect.arrayContaining([expect.stringContaining(reason)]) })
  })
})
