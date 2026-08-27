import { describe, expect, it } from 'vitest'
import { ManagedBrowserLayoutClient } from '../src/client/managed-browser-layout.ts'

const OPTIONS = {
  mode: 'laptop' as const,
  settleMs: 100,
  hysteresisPx: 4,
  viewportLimits: {
    min: { width: 320, height: 240 },
    max: { width: 1920, height: 1440 },
  },
}

describe('managed Browser authoritative client layout', () => {
  it('keeps a fixed committed viewport stable across container and media dimension changes', () => {
    const client = new ManagedBrowserLayoutClient(OPTIONS)
    client.observeContainer({ width: 640, height: 700 }, 0)
    expect(client.pollProposal(1_000)).toBeUndefined()

    expect(client.acceptCommit({
      revision: 7,
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
      mediaGeneration: 3,
    })).toBe(true)
    expect(client.inputHeld()).toBe(true)

    expect(client.acceptFrame({
      revision: 7,
      mediaGeneration: 3,
      viewport: { width: 1280, height: 800 },
      encodedSize: { width: 1920, height: 1200 },
      deviceSize: { width: 720, height: 860 },
    })).toEqual({ accepted: true, switched: true })

    for (const frame of [
      { encodedSize: { width: 1280, height: 800 }, deviceSize: { width: 390, height: 844 } },
      { encodedSize: { width: 1600, height: 1000 }, deviceSize: { width: 2560, height: 1440 } },
      { encodedSize: { width: 960, height: 600 }, deviceSize: { width: 720, height: 860 } },
    ]) {
      expect(client.acceptFrame({
        revision: 7,
        mediaGeneration: 3,
        viewport: { width: 1280, height: 800 },
        ...frame,
      })).toEqual({ accepted: true, switched: false })
    }

    expect(client.acceptFrame({
      revision: 6,
      mediaGeneration: 2,
      viewport: { width: 720, height: 860 },
      encodedSize: { width: 720, height: 860 },
      deviceSize: { width: 720, height: 860 },
    })).toEqual({ accepted: false, switched: false })

    expect(client.snapshot()).toMatchObject({
      containerSize: { width: 640, height: 700 },
      committed: { revision: 7, viewport: { width: 1280, height: 800 }, mediaGeneration: 3 },
      presented: { revision: 7, viewport: { width: 1280, height: 800 }, mediaGeneration: 3 },
      encodedSize: { width: 960, height: 600 },
      inputHeld: false,
    })
    expect(client.surfaceSize()).toEqual({ width: 640, height: 400 })
    expect(client.mapPoint(
      { x: 320, y: 350 },
      { x: 0, y: 150, width: 640, height: 400 },
    )).toEqual({ revision: 7, x: 640, y: 400 })
  })

  it('proposes an exact fixed preset once and ignores later container measurements', () => {
    const client = new ManagedBrowserLayoutClient({ ...OPTIONS, mode: 'fit' })
    client.observeContainer({ width: 911, height: 733 }, 0)

    expect(client.selectMode('phone', 10)).toEqual({
      proposalSequence: 1,
      mode: 'phone',
      viewport: { width: 390, height: 844 },
    })

    client.observeContainer({ width: 1200, height: 900 }, 20)
    expect(client.pollProposal(2_000)).toBeUndefined()
    expect(client.snapshot().containerSize).toEqual({ width: 1200, height: 900 })
  })

  it('settles the latest fit measurement and suppresses jitter within hysteresis', () => {
    const client = new ManagedBrowserLayoutClient({ ...OPTIONS, mode: 'fit' })
    client.observeContainer({ width: 800, height: 600 }, 0)
    for (let index = 1; index <= 20; index += 1) {
      client.observeContainer({
        width: 800 + index % 3,
        height: 600 - index % 2,
      }, index * 4)
    }

    expect(client.proposalDueAt()).toBe(100)
    expect(client.pollProposal(99)).toBeUndefined()
    expect(client.pollProposal(100)).toEqual({
      proposalSequence: 1,
      mode: 'fit',
      viewport: { width: 802, height: 600 },
    })

    client.observeContainer({ width: 805, height: 598 }, 110)
    expect(client.pollProposal(1_000)).toBeUndefined()

    client.observeContainer({ width: 900, height: 700 }, 1_100)
    expect(client.pollProposal(1_199)).toBeUndefined()
    client.observeContainer({ width: 980, height: 720 }, 1_200)
    expect(client.proposalDueAt()).toBe(1_300)
    expect(client.pollProposal(1_299)).toBeUndefined()
    expect(client.pollProposal(1_300)).toEqual({
      proposalSequence: 2,
      mode: 'fit',
      viewport: { width: 980, height: 720 },
    })
  })

  it('suspends fit proposals while the Mobile IME is visible and settles after it closes', () => {
    const client = new ManagedBrowserLayoutClient({ ...OPTIONS, mode: 'fit' })
    client.observeContainer({ width: 390, height: 700 }, 0)
    client.setImeVisible(true, 50)

    expect(client.pollProposal(500)).toBeUndefined()

    client.setImeVisible(false, 500)
    expect(client.pollProposal(599)).toBeUndefined()
    expect(client.pollProposal(600)).toEqual({
      proposalSequence: 1,
      mode: 'fit',
      viewport: { width: 390, height: 700 },
    })
  })

  it('uses a fit commit as the hysteresis baseline and clamps later proposals', () => {
    const client = new ManagedBrowserLayoutClient({ ...OPTIONS, mode: 'fit' })
    expect(client.acceptCommit({
      revision: 1,
      mode: 'fit',
      viewport: { width: 800, height: 600 },
      mediaGeneration: 1,
    })).toBe(true)

    client.observeContainer({ width: 803, height: 598 }, 0)
    expect(client.pollProposal(100)).toBeUndefined()

    client.observeContainer({ width: 2_400, height: 120 }, 200)
    expect(client.pollProposal(300)).toEqual({
      proposalSequence: 1,
      mode: 'fit',
      viewport: { width: 1920, height: 240 },
    })
  })

  it('retains the latest selected mode while an earlier Host commit finishes', () => {
    const client = new ManagedBrowserLayoutClient(OPTIONS)
    client.observeContainer({ width: 900, height: 700 }, 0)
    expect(client.selectMode('fit', 10)).toBeUndefined()

    expect(client.acceptCommit({
      revision: 1,
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
      mediaGeneration: 1,
    })).toBe(true)
    expect(client.snapshot().mode).toBe('fit')
    expect(client.pollProposal(110)).toEqual({
      proposalSequence: 1,
      mode: 'fit',
      viewport: { width: 900, height: 700 },
    })
  })

  it('holds input and keeps the old presentation until the first frame for a monotonic commit', () => {
    const client = new ManagedBrowserLayoutClient(OPTIONS)
    client.observeContainer({ width: 640, height: 640 }, 0)
    const first = { revision: 2, mode: 'phone' as const, viewport: { width: 390, height: 844 }, mediaGeneration: 4 }
    expect(client.acceptCommit(first)).toBe(true)
    expect(client.acceptFrame({
      revision: 2,
      mediaGeneration: 4,
      viewport: first.viewport,
      encodedSize: { width: 585, height: 1266 },
    })).toEqual({ accepted: true, switched: true })
    expect(client.surfaceSize()).toEqual({ width: 296, height: 640 })

    expect(client.acceptCommit({ ...first, revision: 2, mediaGeneration: 5 })).toBe(false)
    expect(client.acceptCommit({ ...first, revision: 1 })).toBe(false)
    const next = { revision: 3, mode: 'laptop' as const, viewport: { width: 1280, height: 800 }, mediaGeneration: 5 }
    expect(client.acceptCommit(next)).toBe(true)
    expect(client.inputHeld()).toBe(true)
    expect(client.surfaceSize()).toEqual({ width: 296, height: 640 })
    expect(client.mapPoint({ x: 148, y: 320 }, { x: 0, y: 0, width: 296, height: 640 })).toBeUndefined()

    expect(client.acceptFrame({
      revision: 4,
      mediaGeneration: 6,
      viewport: next.viewport,
      encodedSize: { width: 1280, height: 800 },
    })).toEqual({ accepted: false, switched: false })
    expect(client.acceptFrame({
      revision: 3,
      mediaGeneration: 5,
      viewport: { width: 1279, height: 800 },
      encodedSize: { width: 1280, height: 800 },
    })).toEqual({ accepted: false, switched: false })
    expect(client.acceptFrame({
      revision: 3,
      mediaGeneration: 5,
      viewport: next.viewport,
      encodedSize: { width: 1920, height: 1200 },
    })).toEqual({ accepted: true, switched: true })
    expect(client.inputHeld()).toBe(false)
    expect(client.surfaceSize()).toEqual({ width: 640, height: 400 })
    expect(client.acceptCommit({ ...next, revision: 4, mediaGeneration: 4 })).toBe(false)
  })
})
