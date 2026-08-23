/** Terminal 工具 pane: xterm.js over the human pty, one emulator per Tab. */

import { useEffect, useRef, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { watchTerminalTheme } from './terminal-theme.ts'
import { terminalFontFamily, terminalOptions } from './terminal-options.ts'
import { startSerialPull } from './serial-pull.ts'

export function TerminalPane({
  snapshot,
  onIntent,
  tabId,
  onPull,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
  tabId: string
  onPull?: (tabId: string, since: number) => Promise<{ seq: number; chunk: string } | undefined>
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const seqRef = useRef(0)
  const onPullRef = useRef(onPull)
  const onIntentRef = useRef(onIntent)
  onPullRef.current = onPull
  onIntentRef.current = onIntent
  const pty = snapshot.terminal.byTab[tabId]

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    seqRef.current = 0
    const hostFont = getComputedStyle(host).getPropertyValue('--ds-font-family-code').trim()
    const term = new Terminal(terminalOptions(terminalFontFamily(hostFont)))
    const fit = new FitAddon()
    const unicode11 = new Unicode11Addon()
    term.loadAddon(fit)
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'
    term.open(host)
    const stopTheme = watchTerminalTheme(host, (theme) => {
      term.options.theme = theme
    })
    try { fit.fit() } catch { /* host may still be 0x0 on first paint */ }
    termRef.current = term
    const writeSub = term.onData((bytes) => {
      onIntent({ type: 'terminal-write', tabId, bytes })
    })
    const sendSize = (): void => {
      try { fit.fit() } catch { return }
      onIntent({ type: 'terminal-resize', tabId, cols: term.cols, rows: term.rows })
    }
    onIntent({ type: 'terminal-open', tabId, cols: term.cols, rows: term.rows })
    const ro = new ResizeObserver(() => { sendSize() })
    ro.observe(host)
    term.focus()
    return () => {
      stopTheme()
      ro.disconnect()
      writeSub.dispose()
      termRef.current = null
      term.dispose()
    }
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps -- one emulator per Tab; onIntent is unstable

  useEffect(() => {
    return startSerialPull({
      intervalMs: 100,
      pull: () => {
        const pull = onPullRef.current
        if (pull !== undefined) return pull(tabId, seqRef.current)
        onIntentRef.current({ type: 'terminal-refresh', tabId, since: seqRef.current })
        return Promise.resolve(undefined)
      },
      onResult: (pulled) => {
        if (pulled.seq <= seqRef.current || pulled.chunk.length === 0) return
        termRef.current?.write(pulled.chunk)
        seqRef.current = pulled.seq
      },
    })
  }, [tabId])

  useEffect(() => {
    const live = new Set(
      snapshot.tabs.filter((tab) => tab.kind === 'Terminal').map((tab) => tab.id),
    )
    for (const id of Object.keys(snapshot.terminal.byTab)) {
      if (!live.has(id)) onIntent({ type: 'terminal-destroy', tabId: id })
    }
  }, [snapshot.tabs, snapshot.terminal.byTab]) // eslint-disable-line react-hooks/exhaustive-deps -- reap closed Tabs only

  useEffect(() => {
    const seq = pty?.seq ?? 0
    const chunk = pty?.chunk ?? ''
    if (seq <= seqRef.current || chunk.length === 0) return
    termRef.current?.write(chunk)
    seqRef.current = seq
  }, [pty?.seq, pty?.chunk])

  return (
    <div
      ref={hostRef}
      className="dcs-term"
      onClick={() => { termRef.current?.focus() }}
    />
  )
}
