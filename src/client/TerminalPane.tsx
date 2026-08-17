/** Terminal 工具 pane: the human's shell, full pane height, one pty per Tab. */

import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'

export function TerminalPane({
  snapshot,
  onIntent,
  tabId,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
  tabId: string
}): ReactElement {
  const [draft, setDraft] = useState('')
  const pty = snapshot.terminal.byTab[tabId]
  const cwd = pty?.cwd ?? ''
  const output = pty?.output ?? ''

  useEffect(() => {
    onIntent({ type: 'terminal-open', tabId })
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps -- open once per Tab; onIntent is unstable

  useEffect(() => {
    const live = new Set(
      snapshot.tabs.filter((tab) => tab.kind === 'Terminal').map((tab) => tab.id),
    )
    for (const id of Object.keys(snapshot.terminal.byTab)) {
      if (!live.has(id)) onIntent({ type: 'terminal-destroy', tabId: id })
    }
  }, [snapshot.tabs, snapshot.terminal.byTab]) // eslint-disable-line react-hooks/exhaustive-deps -- reap closed Tabs only

  useEffect(() => {
    setDraft('')
  }, [tabId])

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const bytes = draft.endsWith('\n') ? draft : `${draft}\n`
    if (draft.length === 0) return
    onIntent({ type: 'terminal-write', tabId, bytes })
    setDraft('')
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '14px 16px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: '12.5px',
        lineHeight: 1.55,
      }}
    >
      {output.length > 0 && (
        <pre style={{ margin: 0, font: 'inherit', whiteSpace: 'pre-wrap' }}>{output}</pre>
      )}
      <form onSubmit={onSubmit} style={{ display: 'flex' }}>
        <span style={{ color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre' }}>
          {cwd.length > 0 ? `${cwd} $ ` : '$ '}
        </span>
        <input
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Terminal"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 0,
            outline: 'none',
            color: 'inherit',
            font: 'inherit',
          }}
        />
      </form>
    </div>
  )
}
