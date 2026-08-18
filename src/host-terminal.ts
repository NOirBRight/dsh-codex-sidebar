/** Host TerminalPort: one real pty per Tab, cwd is the 主会话 workspace. Reconnect by token. */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { clipTerminalOutput, type TerminalPort, type TerminalPull, type TerminalSize } from './terminal.ts'

const require = createRequire(import.meta.url)

type PtyHandle = {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: () => void): void
}

type LivePty = {
  child: PtyHandle
  buf: string
  seq: number
  start: number
  token: string
}

type NodePtyModule = {
  spawn: (
    file: string,
    args: string[],
    opts: { name?: string; cols?: number; rows?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => {
    pid: number
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(): void
    onData(cb: (data: string) => void): { dispose(): void }
    onExit(cb: (e: { exitCode: number }) => void): { dispose(): void }
  }
}

export function createHostTerminal(cwdOf: () => string): TerminalPort {
  const byToken = new Map<string, LivePty>()
  const tokenOf = new Map<string, string>()
  return {
    cwd: cwdOf,
    create(tabId, cwd, token, size) {
      const held = token !== undefined ? byToken.get(token) : undefined
      if (held !== undefined) {
        tokenOf.set(tabId, held.token)
        if (size !== undefined) held.child.resize(size.cols, size.rows)
        return held.token
      }
      const current = tokenOf.get(tabId)
      if (current !== undefined && byToken.has(current)) return current
      const child = openHandle(cwd, size)
      const next: LivePty = { child, buf: '', seq: 0, start: 0, token: 'pty-' + (child.pid || tabId) }
      child.onData((data) => { append(next, data) })
      child.onExit(() => {
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
      live(tabId)?.child.write(bytes)
    },
    resize(tabId, cols, rows) {
      if (cols < 2 || rows < 1) return
      live(tabId)?.child.resize(cols, rows)
    },
    destroy(tabId) {
      const rec = live(tabId)
      if (rec === undefined) return
      rec.child.kill()
      byToken.delete(rec.token)
      tokenOf.delete(tabId)
    },
    read(tabId) {
      return live(tabId)?.buf ?? ''
    },
    pull(tabId, since) {
      return pullFrom(live(tabId), since)
    },
  }

  function live(tabId: string): LivePty | undefined {
    const token = tokenOf.get(tabId)
    return token === undefined ? undefined : byToken.get(token)
  }
}

function append(rec: LivePty, chunk: string): void {
  rec.buf = clipTerminalOutput(rec.buf + chunk)
  rec.seq += chunk.length
  rec.start = rec.seq - rec.buf.length
}

function pullFrom(rec: LivePty | undefined, since: number): TerminalPull {
  if (rec === undefined) return { seq: 0, chunk: '' }
  if (since < rec.start) return { seq: rec.seq, chunk: rec.buf }
  return { seq: rec.seq, chunk: rec.buf.slice(since - rec.start) }
}

function openHandle(cwd: string, size?: TerminalSize): PtyHandle {
  try {
    return openNodePty(cwd, size)
  } catch {
    return openScriptPty(cwd)
  }
}

function openNodePty(cwd: string, size?: TerminalSize): PtyHandle {
  const pty = require('node-pty') as NodePtyModule
  const shell = process.env['SHELL'] ?? '/bin/sh'
  const child = pty.spawn(shell, ['-i'], {
    name: 'xterm-256color',
    cols: size?.cols ?? 80,
    rows: size?.rows ?? 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  })
  return {
    pid: child.pid,
    write(data) { child.write(data) },
    resize(cols, rows) { child.resize(cols, rows) },
    kill() { child.kill() },
    onData(cb) { child.onData(cb) },
    onExit(cb) { child.onExit(() => { cb() }) },
  }
}

function openScriptPty(cwd: string): PtyHandle {
  const shell = process.env['SHELL'] ?? '/bin/sh'
  const quoted = shell + ' -i'
  const child: ChildProcessWithoutNullStreams = existsSync('/usr/bin/script')
    ? spawn('script', ['-qefc', quoted, '/dev/null'], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    : spawn(shell, ['-i'], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  return {
    pid: child.pid ?? 0,
    write(data) { child.stdin.write(data) },
    resize() {},
    kill() { child.kill() },
    onData(cb) {
      child.stdout.on('data', (buf: Buffer) => { cb(buf.toString()) })
      child.stderr.on('data', (buf: Buffer) => { cb(buf.toString()) })
    },
    onExit(cb) { child.on('exit', cb) },
  }
}
