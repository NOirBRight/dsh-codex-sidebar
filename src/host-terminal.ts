/** Host TerminalPort: one child shell per Tab, cwd is the 主会话 workspace. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TerminalPort } from './terminal.ts'

type LivePty = {
  child: ChildProcessWithoutNullStreams
  output: string
}

export function createHostTerminal(cwdOf: () => string): TerminalPort {
  const live = new Map<string, LivePty>()
  return {
    cwd: cwdOf,
    create(tabId, cwd) {
      if (live.has(tabId)) return
      const shell = process.env['SHELL'] ?? '/bin/sh'
      const child = spawn(shell, ['-i'], {
        cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const rec: LivePty = { child, output: '' }
      child.stdout.on('data', (buf: Buffer) => {
        rec.output += buf.toString()
      })
      child.stderr.on('data', (buf: Buffer) => {
        rec.output += buf.toString()
      })
      child.on('exit', () => {
        live.delete(tabId)
      })
      live.set(tabId, rec)
    },
    write(tabId, bytes) {
      live.get(tabId)?.child.stdin.write(bytes)
    },
    destroy(tabId) {
      const rec = live.get(tabId)
      if (rec === undefined) return
      rec.child.kill()
      live.delete(tabId)
    },
    read(tabId) {
      return live.get(tabId)?.output ?? ''
    },
  }
}
