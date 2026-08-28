import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedBrowserEvidenceStore } from '../src/managed-browser-evidence.ts'
import type { ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dcs-evidence-'))
  roots.push(root)
  const targetIdentity = Object.freeze({ target: 'first' })
  const replacementIdentity = Object.freeze({ target: 'replacement' })
  const capture = vi.fn(async () => ({
    captureId: 's1:b1:d1:c1',
    documentId: 's1:b1:d1',
    layoutRevision: 4,
    mediaGeneration: 7,
    url: 'https://example.com',
    title: 'Example',
    image: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    mediaType: 'image/jpeg' as const,
    width: 720,
    height: 860,
    nodes: [{ ref: '@d1e1', role: 'button', name: 'Save', selector: '#save', rect: { x: 1, y: 2, w: 3, h: 4 } }],
    targetIdentity,
  }))
  let identity = { documentId: 's1:b1:d1', layoutRevision: 4, mediaGeneration: 7 }
  let currentTargetIdentity = targetIdentity
  let identityReads = 0
  let replaceAtIdentityRead: number | undefined
  const runtime = {
    capture,
    captureIdentity: (_tab: unknown, expectedTarget?: object) => {
      identityReads += 1
      if (identityReads === replaceAtIdentityRead) currentTargetIdentity = replacementIdentity
      return expectedTarget === undefined || expectedTarget === currentTargetIdentity ? identity : undefined
    },
  } as unknown as ManagedBrowserRuntime
  return {
    root,
    capture,
    replaceAtIdentityRead: (read: number) => { replaceAtIdentityRead = read },
    setIdentity: (value: typeof identity) => { identity = value },
    store: new ManagedBrowserEvidenceStore(runtime, { root }),
  }
}

describe('ManagedBrowserEvidenceStore', () => {
  it('keeps captures in memory until commit, then writes one draft JPEG sidecar', async () => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' }, { revision: 4, mediaGeneration: 7 })
    expect(metadata).toMatchObject({ captureId: 's1:b1:d1:c1', documentId: 's1:b1:d1', layoutRevision: 4, mediaGeneration: 7, nodes: [{ selector: '#save' }] })
    expect(metadata).not.toHaveProperty('targetIdentity')
    expect(box.capture).toHaveBeenCalledWith({ sessionId: 's1', tabId: 'b1' }, { revision: 4, mediaGeneration: 7 })
    expect(await readdir(box.root)).toEqual([])

    const evidence = await box.store.commit('s1', metadata.captureId, { revision: 4, mediaGeneration: 7 })
    expect(evidence).toMatchObject({ captureId: metadata.captureId, documentId: metadata.documentId, layoutRevision: 4, mediaGeneration: 7, mediaType: 'image/jpeg' })
    await expect(box.store.read('s1', evidence)).resolves.toEqual({
      mediaType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64'),
    })
    await expect(box.store.commit('s1', metadata.captureId, { revision: 4, mediaGeneration: 7 })).resolves.toEqual(evidence)
  })

  it('does not let a different session commit a temporary capture', async () => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' }, { revision: 4, mediaGeneration: 7 })
    await expect(box.store.commit('s2', metadata.captureId, { revision: 4, mediaGeneration: 7 })).rejects.toThrow('missing or expired')
    expect(await readdir(box.root)).toEqual([])
  })

  it('rejects a temporary capture after navigation or layout reflow and writes no evidence', async () => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' }, { revision: 4, mediaGeneration: 7 })
    box.setIdentity({ documentId: 's1:b1:d2', layoutRevision: 5, mediaGeneration: 8 })
    await expect(box.store.commit('s1', metadata.captureId, { revision: 4, mediaGeneration: 7 })).rejects.toThrow('stale')
    expect(await readdir(box.root)).toEqual([])
  })

  it.each([
    ['commit', 2, false],
    ['write', 3, false],
    ['rename', 4, true],
  ] as const)('rejects an exact target replacement at the %s checkpoint even when public identity collides', async (_checkpoint, identityRead, published) => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' }, { revision: 4, mediaGeneration: 7 })
    box.replaceAtIdentityRead(identityRead)

    await expect(box.store.commit('s1', metadata.captureId, { revision: 4, mediaGeneration: 7 })).rejects.toThrow('stale')
    const entries = await readdir(box.root, { recursive: true })
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([])
    expect(entries.some((entry) => entry.endsWith('.jpg'))).toBe(published)
    await expect(box.store.commit('s1', metadata.captureId, { revision: 4, mediaGeneration: 7 })).rejects.toThrow('missing or expired')
  })
})
