import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHostTerminal } from '../src/host-terminal.ts'
import { createSidebarSession } from '../src/session.ts'
import type { FilesPort, PersistPort, SidebarSnapshot } from '../src/session.ts'
import { TERMINAL_OUTPUT_CAP, type TerminalPort } from '../src/terminal.ts'

const WORKSPACE = '/work/foo'
const TUI_DUMP = `\x1b[H\x1b[2J${'X'.repeat(2_000_000)}`
const MAX_SAFE_PAYLOAD = TERMINAL_OUTPUT_CAP

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

function trackingPersist(): PersistPort & { lastBytes(): number } {
  const map = new Map<string, string>()
  let lastBytes = 0
  return {
    lastBytes() {
      return lastBytes
    },
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw) as SidebarSnapshot
    },
    save(sessionId, snapshot) {
      const raw = JSON.stringify(snapshot)
      lastBytes = raw.length
      map.set(sessionId, raw)
    },
  }
}

function dumpPort(output: string): TerminalPort {
  return {
    cwd() {
      return WORKSPACE
    },
    create() {
      return 'pty-tui'
    },
    write() {},
    destroy() {},
    read() {
      return output
    },
  }
}

describe('Terminal TUI dump must not freeze the host', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  it('keeps a TUI-sized dump from bloating persist/RPC payloads', () => {
    expect(TUI_DUMP.length).toBeGreaterThan(1_500_000)
    const persist = trackingPersist()
    const box = createSidebarSession({
      sessionId: 'sess-tui',
      files: memoryFiles({ 'README.md': '# foo\n' }),
      persist,
      isBusy: () => false,
      terminal: dumpPort(TUI_DUMP),
    })
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    const tabId = box.snapshot().tabs[0]?.id as string
    box.dispatch({ type: 'terminal-open', tabId })

    const started = performance.now()
    box.dispatch({ type: 'terminal-refresh', tabId })
    const elapsed = performance.now() - started
    const payload = persist.lastBytes()
    const output = box.snapshot().terminal.byTab[tabId]?.output ?? ''

    expect(output.length, 'output ' + output.length + ' must stay UI-safe').toBeLessThanOrEqual(MAX_SAFE_PAYLOAD)
    expect(payload, 'persist ' + payload + ' must stay UI-safe').toBeLessThanOrEqual(MAX_SAFE_PAYLOAD)
    expect(elapsed, 'refresh ' + elapsed + 'ms must stay off the host event loop').toBeLessThan(50)
  })

  it('caps a live TUI redraw storm from the host pty', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dcs-term-'))
    dirs.push(cwd)
    const port = createHostTerminal(() => cwd)
    const tabId = 't-live'
    port.create(tabId, cwd)
    port.write(tabId, 'node -e \'process.stdout.write("X".repeat(2_000_000))\'\n')

    const deadline = Date.now() + 4000
    let output = ''
    while (Date.now() < deadline) {
      output = port.read(tabId)
      if (output.includes('X'.repeat(1000))) {
        await new Promise((resolve) => setTimeout(resolve, 80))
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(output.includes('X'.repeat(1000)), 'child should have printed the TUI-sized dump').toBe(true)
    expect(port.read(tabId).length, 'live pty buffer must stay capped').toBeLessThanOrEqual(MAX_SAFE_PAYLOAD)
    port.destroy(tabId)
  })
})
