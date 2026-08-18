/** Session rail inside Terminal: list, create, and switch human ptys. */

import { useState, type ReactElement } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { Ico } from './icons.tsx'
import type { SidebarKey } from './locales.ts'

export function TerminalRail({
  snapshot,
  onIntent,
  tabId,
  t,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
  tabId: string
  t: (key: SidebarKey) => string
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const sessions = snapshot.tabs.filter((tab) => tab.kind === 'Terminal')

  if (collapsed) {
    return (
      <div className="dcs-term-rail" data-collapsed="">
        <button
          type="button"
          className="dcs-term-rail-icon"
          title={t('expandTerminals')}
          aria-label={t('expandTerminals')}
          onClick={() => { setCollapsed(false) }}
        >
          <Ico name="panel" size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="dcs-term-rail">
      <div className="dcs-term-rail-head">
        <span className="dcs-term-rail-count">{sessions.length} Terminal</span>
        <button
          type="button"
          className="dcs-term-rail-icon"
          title={t('newTerminal')}
          aria-label={t('newTerminal')}
          onClick={() => { onIntent({ type: 'open-terminal' }) }}
        >
          <Ico name="plus" size={14} />
        </button>
        <button
          type="button"
          className="dcs-term-rail-icon"
          title={t('collapseTerminals')}
          aria-label={t('collapseTerminals')}
          onClick={() => { setCollapsed(true) }}
        >
          <Ico name="panel" size={14} />
        </button>
      </div>
      <div className="dcs-term-rail-list">
        {sessions.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="dcs-term-session"
            data-on={tab.id === tabId || undefined}
            onClick={() => { onIntent({ type: 'select-tab', id: tab.id }) }}
          >
            <Ico name="terminal" size={13} />
            <span className="dcs-term-session-name">{tab.title || 'bash'}</span>
            <span
              className="dcs-term-session-x"
              role="button"
              aria-label={t('closeTab')}
              title={t('closeTab')}
              onClick={(event) => {
                event.stopPropagation()
                onIntent({ type: 'close-tab', id: tab.id })
              }}
            >
              <Ico name="x" size={11} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
