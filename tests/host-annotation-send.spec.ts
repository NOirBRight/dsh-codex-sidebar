import { describe, expect, it } from 'vitest'
import {
  AnnotationSendStore,
  applyAnnotationEnrichment,
  buildStagedBatch,
  enrichUserMessage,
  snippetsFor,
} from '../src/host-annotation-send.ts'
import type { Annotation } from '../src/session.ts'

const fileMark: Annotation = {
  id: 't1',
  text: 'heading',
  from: 'Login.tsx:1',
  source: 'files',
  selector: 'src/Login.tsx:1',
  path: 'src/Login.tsx',
  line: 1,
}

describe('annotation send enrichment', () => {
  it('binds a staged batch to the next user-kind insert and enriches that message', () => {
    const store = new AnnotationSendStore({ now: () => 1_000, ttlMs: 30_000 })
    store.stage({
      sessionId: 'sess-a',
      attachments: [fileMark],
      marks: [{ id: 't1', from: 'Login.tsx:1', source: 'files', selector: 'src/Login.tsx:1', path: 'src/Login.tsx', line: 1 }],
      images: [],
      evidenceText: '批注 1 · Login.tsx:1\n`src/Login.tsx:1`',
    })
    store.bindInserted('sess-a', { id: 'm1', source: { kind: 'plugin' } })
    store.bindInserted('sess-a', { id: 'm2', source: { kind: 'user', rpcId: 'rpc-1' } })
    const messages = applyAnnotationEnrichment([
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'other' }], source: { kind: 'plugin' } },
      { id: 'm2', role: 'user', content: [{ type: 'text', text: 'heading' }], source: { kind: 'user', rpcId: 'rpc-1' } },
    ], store)
    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'other' }])
    expect(messages[1]?.content[0]).toEqual({ type: 'text', text: 'heading' })
    expect(messages[1]?.content[1]).toEqual({ type: 'text', text: '批注 1 · Login.tsx:1\n`src/Login.tsx:1`' })
    expect((messages[1]?.source as { annotations?: unknown[] }).annotations).toHaveLength(1)
    expect(messages[1]?.id).toBe('m2')
    expect(applyAnnotationEnrichment([
      { id: 'm2', role: 'user', content: [{ type: 'text', text: 'heading' }], source: { kind: 'user' } },
    ], store)[0]?.content).toHaveLength(1)
  })

  it('does not park evidence on next-step inserts from other kinds', () => {
    const store = new AnnotationSendStore()
    store.stage({
      sessionId: 'sess-a',
      attachments: [fileMark],
      marks: [],
      images: [],
      evidenceText: 'x',
    })
    store.bindInserted('sess-a', { id: 'ctx', source: { kind: 'plugin', plugin: 'agent-instructions' } })
    expect(store.takeForMessage('ctx')).toBeUndefined()
  })

  it('keeps human text first and appends saved screenshot blocks', () => {
    const image = {
      attachmentId: 'att-1' as never,
      mediaType: 'image/jpeg' as const,
      bytes: 12,
      width: 10,
      height: 10,
      name: 'browser-e1.jpg',
    }
    const enriched = enrichUserMessage(
      { id: 'm2', role: 'user', content: [{ type: 'text', text: 'fix this' }], source: { kind: 'user' } },
      {
        sessionId: 'sess-a',
        attachments: [],
        marks: [{ id: 'b1', from: 'Save', source: 'browser', evidenceId: 'e1' }],
        images: [{ evidenceId: 'e1', attachment: image }],
        evidenceText: '批注 1 · Save',
        expiresAt: 9e12,
      },
    )
    expect(enriched.content).toEqual([
      { type: 'text', text: 'fix this' },
      { type: 'text', text: '批注 1 · Save' },
      { type: 'image', attachment: image },
    ])
  })

  it('fails staging when the 主会话 agent is not live', async () => {
    await expect(buildStagedBatch('sess-a', [fileMark], { agentLive: () => false })).rejects.toThrow('not live')
  })

  it('builds file snippets keyed by path:line', () => {
    expect(snippetsFor([fileMark], (path) => path === 'src/Login.tsx' ? 'export function Login() {\n  return 1\n}' : undefined)['src/Login.tsx:1']).toContain('1|export function Login() {')
  })
})
