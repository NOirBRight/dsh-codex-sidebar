import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_BLOCK_MESSAGE,
  HARNESS_SELF_BLOCK_MESSAGE,
  harnessSelfBlockReason,
  isChallengePage,
} from '../src/browser-guard.ts'

describe('browser-guard', () => {
  it('blocks DSH Web origins that would nest the GUI inside the managed Browser', () => {
    expect(harnessSelfBlockReason('http://127.0.0.1:3080/')).toBe(HARNESS_SELF_BLOCK_MESSAGE)
    expect(harnessSelfBlockReason('http://localhost:3082/settings')).toBe(HARNESS_SELF_BLOCK_MESSAGE)
    expect(harnessSelfBlockReason('https://dsh.noirbright.top/')).toBe(HARNESS_SELF_BLOCK_MESSAGE)
    expect(harnessSelfBlockReason('https://dshlab.noirbright.top/plugins')).toBe(HARNESS_SELF_BLOCK_MESSAGE)
    expect(harnessSelfBlockReason('https://example.com/')).toBeUndefined()
    expect(harnessSelfBlockReason('http://127.0.0.1:4176/')).toBeUndefined()
    expect(harnessSelfBlockReason('https://app.noirbright.top/')).toBeUndefined()
  })

  it('detects Cloudflare challenge pages by title or query', () => {
    expect(isChallengePage('https://chatgpt.com/codex/settings/usage', 'Just a moment...')).toBe(true)
    expect(isChallengePage(
      'https://help.openai.com/en/?__cf_chl_rt_tk=abc',
      'help.openai.com',
    )).toBe(true)
    expect(isChallengePage('https://example.com/', 'Example')).toBe(false)
    expect(CHALLENGE_BLOCK_MESSAGE.length).toBeGreaterThan(0)
  })
})
