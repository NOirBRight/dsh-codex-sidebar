import { describe, expect, it } from 'vitest'
import { SIDEBAR_DISPATCH_ENDPOINT } from '../src/contract.ts'
import { handleSidebarRpc } from '../src/host-rpc.ts'
import { createRegistry } from '../src/registry.ts'
import { createSidebarSession, PALETTE } from '../src/session.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'
import type { TerminalPort } from '../src/terminal.ts'

const WORKSPACE = '/work/foo'

type FakePty = {
  cwd: string
  stdin: string[]
  output: string
  destroyed: boolean
  token: string
}

function memoryFiles(files: Record<string, string>): FilesPort {
  return {
    read(path) {
      return files[path]
    },
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

function fakePtyPort(workspace: string): { port: TerminalPort; ptys: Map<string, FakePty> } {
  const ptys = new Map<string, FakePty>()
  const port: TerminalPort = {
    cwd() {
      return workspace
    },
    create(tabId, cwd, token) {
      if (token !== undefined) {
        for (const pty of ptys.values()) {
          if (pty.token === token && !pty.destroyed) {
            ptys.set(tabId, pty)
            return token
          }
        }
      }
      const existing = ptys.get(tabId)
      if (existing !== undefined && !existing.destroyed) return existing.token
      const next: FakePty = { cwd, stdin: [], output: '', destroyed: false, token: token ?? `pty-${tabId}` }
      ptys.set(tabId, next)
      return next.token
    },
    write(tabId, bytes) {
      const pty = ptys.get(tabId)
      if (pty === undefined || pty.destroyed) return
      pty.stdin.push(bytes)
      pty.output += bytes
    },
    destroy(tabId) {
      const pty = ptys.get(tabId)
      if (pty === undefined) return
      pty.destroyed = true
    },
    read(tabId) {
      return ptys.get(tabId)?.output ?? ''
    },
  }
  return { port, ptys }
}

function session(opts?: { persist?: PersistPort; terminal?: TerminalPort; id?: string }): {
  box: SidebarSession
  persist: PersistPort
} {
  const persist = opts?.persist ?? memoryPersist()
  const files = memoryFiles({ 'README.md': '# foo\n' })
  const box = createSidebarSession({
    sessionId: opts?.id ?? 'sess-a',
    files,
    persist,
    isBusy: () => false,
    ...opts?.terminal === undefined ? {} : { terminal: opts.terminal },
  })
  return { box, persist }
}

function fillTerminal(box: SidebarSession): string {
  box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
  const tabId = box.snapshot().tabs[box.snapshot().tabs.length - 1]?.id as string
  box.dispatch({ type: 'terminal-open', tabId })
  return tabId
}

describe('Terminal seam', () => {
  it('opens a human pty in the 主会话 workspace', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const { box } = session({ terminal: port })
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    expect([...ptys.values()].filter((pty) => !pty.destroyed)).toHaveLength(0)

    const tabId = box.snapshot().tabs[0]?.id as string
    const effects = box.dispatch({ type: 'terminal-open', tabId })
    expect(effects).toEqual([])
    const pty = ptys.get(tabId)
    expect(pty?.destroyed).toBe(false)
    expect(pty?.cwd).toBe(WORKSPACE)
    expect(pty?.token).toBe(`pty-${tabId}`)
    expect(box.snapshot().terminal.byTab[tabId]?.cwd).toBe(WORKSPACE)
    expect(box.snapshot().terminal.byTab[tabId]?.token).toBe(pty?.token)
  })

  it('gives each Terminal Tab its own pty so stdin is not shared', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const { box } = session({ terminal: port })
    const first = fillTerminal(box)
    box.dispatch({ type: 'open-empty-tab' })
    const second = fillTerminal(box)

    box.dispatch({ type: 'terminal-write', tabId: first, bytes: 'ls\n' })
    box.dispatch({ type: 'terminal-write', tabId: second, bytes: 'pwd\n' })

    expect(first).not.toBe(second)
    expect(ptys.get(first)?.stdin).toEqual(['ls\n'])
    expect(ptys.get(second)?.stdin).toEqual(['pwd\n'])
    expect(box.snapshot().terminal.byTab[first]?.output).toBe('ls\n')
    expect(box.snapshot().terminal.byTab[second]?.output).toBe('pwd\n')
  })

  it('destroys a pty when its Tab closes and leaves the other alive', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const { box } = session({ terminal: port })
    const first = fillTerminal(box)
    box.dispatch({ type: 'open-empty-tab' })
    const second = fillTerminal(box)

    box.dispatch({ type: 'close-tab', id: first })
    box.dispatch({ type: 'terminal-destroy', tabId: first })

    expect(ptys.get(first)?.destroyed).toBe(true)
    expect(ptys.get(second)?.destroyed).toBe(false)
    expect(box.snapshot().terminal.byTab[first]).toBeUndefined()
    expect(box.snapshot().terminal.byTab[second]?.cwd).toBe(WORKSPACE)
  })

  it('does not inject typed commands or output into the 主会话', () => {
    const { port } = fakePtyPort(WORKSPACE)
    const { box } = session({ terminal: port })
    const tabId = fillTerminal(box)
    const effects = box.dispatch({ type: 'terminal-write', tabId, bytes: 'ls\n' })
    expect(effects).toEqual([])
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().queue).toEqual([])
  })

  it('does not attach 舵主 commands to the human pty', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const { box } = session({ terminal: port })
    const tabId = fillTerminal(box)
    box.dispatch({ type: 'terminal-write', tabId, bytes: 'ls\n' })
    const sent = box.dispatch({ type: 'composer-send', text: 'run the tests' })
    expect(sent).toEqual([{ type: 'send', text: 'run the tests', attachments: [] }])
    expect(ptys.get(tabId)?.stdin).toEqual(['ls\n'])
  })

  it('reconnects a Terminal when the 主会话 reopens if the host still holds it', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const persist = memoryPersist()
    const { box } = session({ persist, terminal: port })
    const tabId = fillTerminal(box)
    box.dispatch({ type: 'terminal-write', tabId, bytes: 'npm test\n' })

    const reopened = createSidebarSession({
      sessionId: 'sess-a',
      files: memoryFiles({ 'README.md': '# foo\n' }),
      persist,
      isBusy: () => false,
      terminal: port,
    })
    expect(ptys.get(tabId)?.destroyed).toBe(false)
    reopened.dispatch({ type: 'terminal-open', tabId })
    expect(ptys.get(tabId)?.stdin).toEqual(['npm test\n'])
    expect(reopened.snapshot().terminal.byTab[tabId]?.output).toBe('npm test\n')
    expect(reopened.snapshot().terminal.byTab[tabId]?.cwd).toBe(WORKSPACE)
    expect(reopened.snapshot().terminal.byTab[tabId]?.token).toBe(ptys.get(tabId)?.token)
  })

  it('opens a pty through RPC with a fake port and does not inject output', () => {
    const { port, ptys } = fakePtyPort(WORKSPACE)
    const registry = createRegistry({
      persist: memoryPersist(),
      filesFor: () => memoryFiles({ 'README.md': '# foo\n' }),
      terminalFor: () => port,
    })
    const picked = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: WORKSPACE,
      busy: false,
      intent: { type: 'pick-tool', kind: 'Terminal' },
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok) return
    const tabId = (picked.value as { snapshot: { tabs: Array<{ id: string }> } }).snapshot.tabs[0]?.id as string
    const opened = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: WORKSPACE,
      busy: false,
      intent: { type: 'terminal-open', tabId },
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const written = handleSidebarRpc(registry, SIDEBAR_DISPATCH_ENDPOINT, {
      sessionId: 'sess-a',
      cwd: WORKSPACE,
      busy: false,
      intent: { type: 'terminal-write', tabId, bytes: 'ls\n' },
    })
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const reply = written.value as { snapshot: { attachments: unknown[]; queue: unknown[] }; effects: unknown[] }
    expect(reply.effects).toEqual([])
    expect(reply.snapshot.attachments).toEqual([])
    expect(reply.snapshot.queue).toEqual([])
    expect(ptys.get(tabId)?.cwd).toBe(WORKSPACE)
    expect(ptys.get(tabId)?.stdin).toEqual(['ls\n'])
  })
})
