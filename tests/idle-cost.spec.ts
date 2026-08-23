import { describe, expect, it, vi } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_SNAPSHOT_ENDPOINT, SIDEBAR_TERMINAL_PULL_ENDPOINT } from '../src/contract.ts'
import { handleSidebarRpc, handleSidebarRpcAsync } from '../src/host-rpc.ts'
import { createRegistry } from '../src/registry.ts'
import { createSidebarSession } from '../src/session.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'
import type { TerminalPort } from '../src/terminal.ts'

function memoryPersist(): PersistPort {
  const map = new Map<string, string>()
  return {
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    save(sessionId, snapshot) { map.set(sessionId, JSON.stringify(snapshot)) },
  }
}

function fakePty(): TerminalPort {
  return {
    cwd: () => '/work',
    create: (tabId) => tabId,
    write() {},
    destroy() {},
    read() { return 'hello' },
    pull(_tabId, since) { return { seq: since + 5, chunk: 'world' } },
  }
}

describe('idle-cost seams', () => {
  it('pulls terminal bytes without recomputing the Files tree', () => {
    let trees = 0
    const files: FilesPort = {
      read() { return '' },
      tree() {
        trees += 1
        return []
      },
    }
    const registry = createRegistry({
      persist: memoryPersist(),
      filesFor: () => files,
      terminalFor: () => fakePty(),
    })
    handleSidebarRpc(registry, SIDEBAR_TERMINAL_PULL_ENDPOINT, {
      sessionId: 'sess-a',
      tabId: 't1',
      since: 0,
    })
    const afterCreate = trees
    const pulled = handleSidebarRpc(registry, SIDEBAR_TERMINAL_PULL_ENDPOINT, {
      sessionId: 'sess-a',
      tabId: 't1',
      since: 0,
    })
    expect(pulled).toEqual({ ok: true, value: { seq: 5, chunk: 'world' } })
    expect(trees).toBe(afterCreate)
  })

  it('reuses a snapshot computed in the same 200ms window', () => {
    let trees = 0
    const files: FilesPort = {
      read() { return 'x' },
      tree() {
        trees += 1
        return []
      },
    }
    const registry = createRegistry({ persist: memoryPersist(), filesFor: () => files })
    const gate = { sessionId: 'sess-a', cwd: '/w', busy: false }
    handleSidebarRpc(registry, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    const afterFirst = trees
    for (let client = 0; client < 4; client += 1) {
      handleSidebarRpc(registry, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    }
    expect(trees).toBe(afterFirst)
    handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, { ...gate, intent: { type: 'pick-tool', kind: 'Files' } })
    handleSidebarRpc(registry, SIDEBAR_SNAPSHOT_ENDPOINT, gate)
    expect(trees).toBeGreaterThan(1)
  })
  it('skips Files and Review projection while collapsed or in a background Tab', () => {
    let trees = 0
    let git = 0
    const box = createSidebarSession({
      sessionId: 'sess-hidden',
      persist: memoryPersist(),
      files: {
        read() { return '' },
        tree() { trees += 1; return [] },
        stats() { git += 1; return {} },
      },
      review: {
        turnWrites() { return [] },
        workingTree() { git += 1; return [] },
        isBusy() { return false },
      },
      isBusy: () => false,
    })

    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    box.snapshot()
    box.dispatch({ type: 'open-empty-tab' })
    box.dispatch({ type: 'pick-tool', kind: 'Review' })
    box.snapshot()
    expect(trees).toBeGreaterThan(0)
    expect(git).toBeGreaterThan(0)

    const beforeCollapse = { trees, git }
    box.dispatch({ type: 'toggle-collapsed' })
    box.snapshot()
    expect({ trees, git }).toEqual(beforeCollapse)

    box.dispatch({ type: 'toggle-collapsed' })
    box.dispatch({ type: 'open-empty-tab' })
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    const beforeBackground = { trees, git }
    box.snapshot()
    expect({ trees, git }).toEqual(beforeBackground)
  })

  it('skips Files tree and Review git when those tabs are closed', () => {
    let trees = 0
    let git = 0
    const box = createSidebarSession({
      sessionId: 'sess-idle',
      persist: memoryPersist(),
      files: {
        read() { return '' },
        tree() { trees += 1; return [] },
        stats() { git += 1; return {} },
      },
      review: {
        turnWrites() { return [] },
        workingTree() { git += 1; return [] },
        isBusy() { return false },
      },
      isBusy: () => false,
    })
    box.snapshot()
    expect(trees).toBe(0)
    expect(git).toBe(0)
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    box.snapshot()
    expect(trees).toBe(0)
    expect(git).toBe(0)
    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    expect(trees).toBe(0)
    box.snapshot()
    expect(trees).toBeGreaterThan(0)
  })

  it('does not enumerate managed browsers on terminal-pull', async () => {
    const list = vi.fn(() => [])
    const registry = createRegistry({
      persist: memoryPersist(),
      filesFor: () => ({ read() { return '' }, tree() { return [] } }),
      terminalFor: () => fakePty(),
    })
    await handleSidebarRpcAsync(registry, SIDEBAR_TERMINAL_PULL_ENDPOINT, {
      sessionId: 'sess-a',
      tabId: 't1',
      since: 0,
    }, { managedBrowser: { list } as never })
    expect(list).not.toHaveBeenCalled()
    await handleSidebarRpcAsync(registry, SIDEBAR_SNAPSHOT_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: '/w',
      busy: false,
    }, { managedBrowser: { list } as never })
    expect(list).toHaveBeenCalled()
  })
})
