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
  const capture = vi.fn(async () => ({
    captureId: 's1:b1:d1:c1',
    documentId: 's1:b1:d1',
    url: 'https://example.com',
    title: 'Example',
    image: new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    mediaType: 'image/jpeg' as const,
    width: 720,
    height: 860,
    nodes: [{ ref: '@d1e1', role: 'button', name: 'Save', selector: '#save', rect: { x: 1, y: 2, w: 3, h: 4 } }],
  }))
  const runtime = {
    capture,
    projection: () => ({ documentId: 's1:b1:d1' }),
  } as unknown as ManagedBrowserRuntime
  return { root, capture, store: new ManagedBrowserEvidenceStore(runtime, { root }) }
}

describe('ManagedBrowserEvidenceStore', () => {
  it('keeps captures in memory until commit, then writes one draft JPEG sidecar', async () => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' })
    expect(metadata).toMatchObject({ captureId: 's1:b1:d1:c1', documentId: 's1:b1:d1', nodes: [{ selector: '#save' }] })
    expect(await readdir(box.root)).toEqual([])

    const evidence = await box.store.commit('s1', metadata.captureId)
    expect(evidence).toMatchObject({ captureId: metadata.captureId, documentId: metadata.documentId, mediaType: 'image/jpeg' })
    await expect(box.store.read('s1', evidence)).resolves.toEqual({
      mediaType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString('base64'),
    })
    await expect(box.store.commit('s1', metadata.captureId)).resolves.toEqual(evidence)
  })

  it('does not let a different session commit a temporary capture', async () => {
    const box = await fixture()
    const metadata = await box.store.capture({ sessionId: 's1', tabId: 'b1' })
    await expect(box.store.commit('s2', metadata.captureId)).rejects.toThrow('missing or expired')
    expect(await readdir(box.root)).toEqual([])
  })
})
