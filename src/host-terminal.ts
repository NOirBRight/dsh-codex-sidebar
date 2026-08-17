/** Host TerminalPort: one pty per Tab, cwd is the 主会话 workspace. Reconnect by token. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { TerminalPort } from './terminal.ts'

type LivePty = {
  child: ChildProcessWithoutNullStreams
  output: string
  token: string
}

export function createHostTerminal(cwdOf: () => string): TerminalPort {
  const byToken = new Map<string, LivePty>()
  const tokenOf = new Map<string, string>()
  return {
    cwd: cwdOf,
    create(tabId, cwd, token) {
      const held = token !== undefined ? byToken.get(token) : undefined
      if (held !== undefined) {
        tokenOf.set(tabId, held.token)
        return held.token
      }
      const current = tokenOf.get(tabId)
      if (current !== undefined && byToken.has(current)) return current
      const child = spawnShell(cwd)
      const next: LivePty = { child, output: '', token: `pty-${child.pid ?? tabId}` }
      child.stdout.on('data', (buf: Buffer) => {
        next.output += buf.toString()
      })
      child.stderr.on('data', (buf: Buffer) => {
        next.output += buf.toString()
      })
      child.on('exit', () => {
        byToken.delete(next.token)
        for (const [id, tok] of tokenOf) {
          if (tok === next.token) tokenOf.delete(id)
        }
      })
      byToken.set(next.token, next)
      tokenOf.set(tabId, next.token)
      return next.token
    },
    write(tabId, bytes) {
      const rec = live(tabId)
      rec?.child.stdin.write(bytes)
    },
    destroy(tabId) {
      const rec = live(tabId)
      if (rec === undefined) return
      rec.child.kill()
      byToken.delete(rec.token)
      tokenOf.delete(tabId)
    },
    read(tabId) {
      return live(tabId)?.output ?? ''
    },
  }

  function live(tabId: string): LivePty | undefined {
    const token = tokenOf.get(tabId)
    return token === undefined ? undefined : byToken.get(token)
  }
}

function spawnShell(cwd: string): ChildProcessWithoutNullStreams {
  const shell = process.env['SHELL'] ?? '/bin/sh'
  if (existsSync('/usr/bin/script')) {
    return spawn('script', ['-qefc', `${shell} -i`, '/dev/null'], {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  return spawn(shell, ['-i'], {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
