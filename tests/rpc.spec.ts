import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_SNAPSHOT_ENDPOINT } from '../src/contract.ts'
import { createFilePersist } from '../src/host-persist.ts'
import { handleSidebarRpc } from '../src/host-rpc.ts'
import { createRegistry } from '../src/registry.ts'
import type { FilesPort } from '../src/session.ts'

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

describe('sidebar RPC', () => {
  it('opens a Files Tab through dispatch and reloads it for the same 主会话', () => {
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

    const registry2 = createRegistry({ persist, filesFor: () => files })
    const loaded = handleSidebarRpc(registry2, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const again = loaded.value as { snapshot: { tabs: Array<{ target: string }> } }
    expect(again.snapshot.tabs[0]?.target).toBe('src/Login.tsx')
    rmSync(root, { recursive: true, force: true })
  })
})
