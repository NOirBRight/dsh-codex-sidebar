import { describe, expect, it, vi } from 'vitest'
import { createManagedBrowserDriveService } from '../src/host-browser-tools.ts'
import type { ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'
import { createSidebarSession } from '../src/session.ts'

function fixture() {
  const projection = new Map<string, { status: 'ready'; title: string }>()
  const ensure = vi.fn(async ({ sessionId, tabId }: { sessionId: string; tabId: string }, url: string) => {
    projection.set(sessionId + ':' + tabId, { status: 'ready', title: 'Managed ' + url })
    return {
      key: sessionId + ':' + tabId,
      url,
      title: 'Managed ' + url,
      documentId: sessionId + ':' + tabId + ':d1',
      status: 'ready' as const,
    }
  })
  const runtime = {
    projection: ({ sessionId, tabId }: { sessionId: string; tabId: string }) => projection.get(sessionId + ':' + tabId),
    ensure,
    snapshot: vi.fn(async () => ({
      url: 'https://public.example/',
      title: 'Public',
      driveable: true as const,
      documentId: 's1:t1:d1',
      nodes: [{ ref: '@d1e1', role: 'button', name: 'Save', selector: '#save' }],
      text: 'document "Public"',
    })),
    click: vi.fn(async () => ({ ok: false as const, code: 'stale-ref' as const, message: '页面已导航' })),
    fill: vi.fn(async () => ({ ok: true as const })),
  } as unknown as ManagedBrowserRuntime
  const session = createSidebarSession({
    sessionId: 's1',
    persist: { load: () => undefined, save: () => {} },
    files: { read: () => undefined, tree: () => [] },
    isBusy: () => false,
    browser: {
      load: (url) => ({ url, title: url, elements: [{ selector: 'body', text: url }] }),
      openExternal: () => {},
      isBusy: () => false,
    },
  })
  return { runtime, service: createManagedBrowserDriveService(runtime), session, ensure }
}

describe('managed Browser tools', () => {
  it('opens and snapshots public https pages without revealing the sidebar', async () => {
    const box = fixture()
    const opened = await box.service.open({}, box.session, 'https://public.example/')
    expect(opened).toMatchObject({ ok: true, tab: { driveable: true, connected: true } })
    expect(box.session.snapshot().collapsed).toBe(true)
    expect(box.ensure).toHaveBeenCalledOnce()

    await expect(box.service.snapshot({}, box.session)).resolves.toMatchObject({
      ok: true,
      snapshot: { documentId: 's1:t1:d1', nodes: [{ ref: '@d1e1' }] },
    })
  })

  it('refuses to nest the DSH web GUI inside the managed Browser', async () => {
    const box = fixture()
    await expect(box.service.open({}, box.session, 'http://127.0.0.1:3080/')).resolves.toMatchObject({
      ok: false,
      code: 'navigation-failed',
    })
    expect(box.ensure).not.toHaveBeenCalled()
    expect(box.session.snapshot().tabs).toEqual([])
  })

  it('maps document-scoped stale refs and keeps the main-session guard', async () => {
    const box = fixture()
    await box.service.open({}, box.session, 'https://public.example/')
    await expect(box.service.click({}, box.session, '@d0e1')).resolves.toMatchObject({ ok: false, code: 'stale-ref' })
    expect(box.service.tabs({ origin: 'subagent' }, box.session)).toMatchObject({ ok: false, code: 'forbidden' })
  })
})
