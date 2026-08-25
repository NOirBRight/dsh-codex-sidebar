import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_SNAPSHOT_ENDPOINT } from '../src/contract.ts'
import { createFilePersist } from '../src/host-persist.ts'
import { handleSidebarRpc, handleSidebarRpcAsync } from '../src/host-rpc.ts'
import { createHostSideChat } from '../src/host-side-chat.ts'
import { createRegistry } from '../src/registry.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'
import { createWorkspaceInspector } from '../src/workspace-inspector.ts'

function memoryFiles(files: Record<string, string>): FilesPort {
  return {
    read(path) { return files[path] },
    tree() {
      return Object.keys(files).sort().map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
      }))
    },
  }
}

function memoryPersist(): PersistPort {
  const map = new Map<string, string>()
  return {
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    save(sessionId, snapshot) {
      map.set(sessionId, JSON.stringify(snapshot))
    },
  }
}

describe('sidebar RPC', () => {
  it('opens a Files Tab through dispatch and reloads it for the same 主会话', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-'))
    const persist = createFilePersist(root)
    const files = memoryFiles({ 'src/Login.tsx': 'export function Login() {}' })
    const registry = createRegistry({ persist, filesFor: () => files })
    const gate = { sessionId: 'sess-a', cwd: '/tmp/foo', busy: false }

    const opened = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      ...gate,
      intent: { type: 'open-path', path: 'src/Login.tsx' },
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const first = opened.value as { snapshot: { collapsed: boolean; tabs: Array<{ target: string }> } }
    expect(first.snapshot.collapsed).toBe(false)
    expect(first.snapshot.tabs[0]?.target).toBe('src/Login.tsx')

    await persist.flush()
    const registry2 = createRegistry({ persist, filesFor: () => files })
    const loaded = handleSidebarRpc(registry2, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const again = loaded.value as { snapshot: { tabs: Array<{ target: string }> } }
    expect(again.snapshot.tabs[0]?.target).toBe('src/Login.tsx')
    rmSync(root, { recursive: true, force: true })
  })

  it('opens a relative transcript path when a remote client omits the session cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-remote-files-'))
    const path = 'docs/superpowers/plans/2026-08-25-zsxq-market-analysis.md'
    mkdirSync(join(root, 'docs/superpowers/plans'), { recursive: true })
    writeFileSync(join(root, path), '# ZSXQ market analysis\n')
    const registry = createRegistry({ persist: memoryPersist() })

    const opened = await handleSidebarRpcAsync(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-remote',
      cwd: '',
      busy: false,
      intent: { type: 'open-path', path },
    }, {
      workspace: createWorkspaceInspector(),
      cwdForSession: (sessionId: string) => sessionId === 'sess-remote' ? root : undefined,
    })

    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const snapshot = (opened.value as { snapshot: { files: { path: string; preview?: string } } }).snapshot
    expect(snapshot.files.path).toBe(path)
    expect(snapshot.files.preview).toBe('# ZSXQ market analysis\n')
    rmSync(root, { recursive: true, force: true })
  })

  it('lists and 投递s through the RPC gate roster and logs', () => {
    const persist = memoryPersist()
    const files = memoryFiles({ 'src/Login.tsx': 'export function Login() {}' })
    const registry = createRegistry({
      persist,
      filesFor: () => files,
      sideChatFor: (sessionId, io) => createHostSideChat({ sessionId, files, io }),
    })
    const gate = {
      sessionId: 'sess-a',
      cwd: '/work',
      busy: false,
      roster: [
        { id: 'sess-a', title: 'Run login', cwd: '/foo', kind: 'main' as const, archived: false, busy: true },
        { id: 'sess-b', title: 'API 改动', cwd: '/bar', kind: 'main' as const, archived: false, busy: false },
        { id: 'sub-1', title: 'helper', cwd: '/foo', kind: 'subagent' as const, archived: false, busy: false },
      ],
      logs: {
        'sess-a': [
          { seq: 1, turn: 1, role: 'user' as const, text: 'fix login' },
          { seq: 2, turn: 1, role: 'assistant' as const, text: 'done', closed: true, writes: ['src/Login.tsx'] },
        ],
      },
    }

    const opened = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      ...gate,
      intent: { type: 'pick-tool', kind: 'Side Chat' },
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const tabId = (opened.value as { snapshot: { active: string } }).snapshot.active

    const listed = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      ...gate,
      intent: { type: 'side-list', tabId },
    })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const listedSnap = listed.value as { snapshot: { sideChat: { byTab: Record<string, { listed: Array<{ id: string }> }> } } }
    expect(listedSnap.snapshot.sideChat.byTab[tabId]?.listed?.map((row) => row.id)).toEqual(['sess-a', 'sess-b'])

    const sent = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      ...gate,
      intent: { type: 'side-send', tabId, text: 'what is this turn doing?' },
    })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    const fork = (sent.value as { snapshot: { sideChat: { byTab: Record<string, { forkSeq: number }> } } })
      .snapshot.sideChat.byTab[tabId]
    expect(fork?.forkSeq).toBe(2)

    const delivered = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      ...gate,
      intent: { type: 'side-deliver', tabId, sessionId: 'sess-b', text: 'use this login plan' },
    })
    expect(delivered.ok).toBe(true)
    if (!delivered.ok) return
    const reply = delivered.value as { effects: Array<{ type: string; to?: string }> }
    expect(reply.effects).toEqual([{
      type: 'deliver',
      to: 'sess-b',
      text: 'use this login plan',
      sourceTab: tabId,
      sourceSession: 'sess-a',
    }])
  })
})
