/** Details-column occupant: Tab strip, Palette, and the active 工具. */

import { useEffect, type ReactElement, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { FilesPane } from './FilesPane.tsx'
import { Ico, tabIcon } from './icons.tsx'
import { NS, type SidebarKey } from './locales.ts'
import { Palette } from './Palette.tsx'
import { BrowserPane } from './BrowserPane.tsx'
import { ReviewPane } from './ReviewPane.tsx'
import { SideChatPane } from './SideChatPane.tsx'
import { TerminalPane } from './TerminalPane.tsx'
import type { SidebarStore } from './controller.ts'
import { SidebarController } from './controller.ts'

export interface SidebarFace {
  hooks: { sidebar: ObservableSnapshot<SidebarStore> }
  controller: SidebarController
}

export type SidebarProps =
  PropsRuntime<'details'>
  & PropsLocale<typeof NS>
  & InjectFace<SidebarFace>

export function SidebarPanel({
  sessionId, useSessions, useSidebar, controller, t,
}: SidebarProps): ReactNode {
  useEffect(() => {
    void controller.refresh(String(sessionId))
  }, [controller, sessionId])

  const snapshot = useSidebar((state) => state.bySession[String(sessionId)])
  const cwd = useSessions((list) => list.byId[sessionId]?.cwd)
  const workspaceName = basename(cwd)

  if (snapshot === undefined) return <div className="dcs-root" />

  return (
    <SidebarChrome
      snapshot={snapshot}
      workspaceName={workspaceName}
      t={t}
      onIntent={(intent) => { void controller.dispatch(String(sessionId), intent) }}
    />
  )
}

function SidebarChrome({
  snapshot,
  workspaceName,
  t,
  onIntent,
}: {
  snapshot: SidebarSnapshot
  workspaceName: string
  t: (key: SidebarKey) => string
  onIntent: (intent: Intent) => void
}): ReactElement {
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.active)
  const showTabs = snapshot.tabs.some((tab) => tab.kind !== null)
  const fill = active?.kind === 'Files' || active?.kind === 'Review' || active?.kind === 'Terminal'
    || active?.kind === 'Browser' || active?.kind === 'Side Chat'

  return (
    <section className="dcs-root">
      {showTabs && (
        <div className="dcs-tabbar">
          {snapshot.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="dcs-tab"
              data-on={tab.id === snapshot.active || undefined}
              onClick={() => { onIntent({ type: 'select-tab', id: tab.id }) }}
            >
              <Ico name={tabIcon(tab.kind)} size={13} />
              <span className="dcs-title">{tab.title}</span>
              <span
                className="dcs-x"
                role="button"
                aria-label={t('closeTab')}
                onClick={(event) => {
                  event.stopPropagation()
                  onIntent({ type: 'close-tab', id: tab.id })
                }}
              >
                <Ico name="x" size={11} />
              </span>
            </button>
          ))}
          <button type="button" className="dcs-plus" title={t('newTab')} onClick={() => { onIntent({ type: 'open-empty-tab' }) }}>
            <Ico name="plus" size={14} />
          </button>
        </div>
      )}
      <div className="dcs-body" data-center={snapshot.showPalette || undefined} data-fill={fill && !snapshot.showPalette || undefined}>
        {snapshot.showPalette && <Palette onPick={(kind) => { onIntent({ type: 'pick-tool', kind }) }} />}
        {!snapshot.showPalette && active?.kind === 'Files' && (
          <FilesPane
            snapshot={snapshot}
            workspaceName={workspaceName}
            onIntent={onIntent}
            annotateLabel={t('annotate')}
            openTreeLabel={t('openTree')}
            closeTreeLabel={t('closeTree')}
            notePlaceholder={t('notePlaceholder')}
          />
        )}
        {!snapshot.showPalette && active?.kind === 'Review' && <ReviewPane later={t('later')} />}
        {!snapshot.showPalette && active?.kind === 'Browser' && (
          <BrowserPane snapshot={snapshot} onIntent={onIntent} />
        )}
        {!snapshot.showPalette && active?.kind === 'Terminal' && (
          <TerminalPane snapshot={snapshot} onIntent={onIntent} tabId={active.id} />
        )}
        {!snapshot.showPalette && active?.kind === 'Side Chat' && (
          <SideChatPane snapshot={snapshot} onIntent={onIntent} />
        )}
      </div>
    </section>
  )
}

function basename(cwd: string | undefined): string {
  if (cwd === undefined || cwd.length === 0) return 'workspace'
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] ?? 'workspace'
}
