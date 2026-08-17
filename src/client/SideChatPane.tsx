/** Side Chat 工具 pane: empty Fork, transcript, 列出 / 察看 / 投递. */

import { useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { emptySideTab, type SideChatMessage, type SideChatTabState } from '../side-chat.ts'
import { Ico } from './icons.tsx'

export function SideChatPane({
  snapshot,
  onIntent,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
}): ReactElement {
  ensureSideChatStyles()
  const tabId = snapshot.active ?? ''
  const tab = snapshot.sideChat.byTab?.[tabId] ?? emptySideTab()
  const [menu, setMenu] = useState(false)
  const empty = tab.messages.length === 0 && tab.listed === null && tab.card === null

  function send(): void {
    const text = tab.draft.trim()
    if (text.length === 0 || tabId.length === 0) return
    setMenu(false)
    onIntent({ type: 'side-send', tabId, text })
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  function deliverTo(sessionId: string): void {
    const text = tab.draft.trim() || lastUserText(tab)
    if (text.length === 0 || tabId.length === 0) return
    onIntent({ type: 'side-deliver', tabId, sessionId, text })
  }

  return (
    <div className="dcs-side">
      {empty ? (
        <div className="dcs-side-empty">
          <Ico name="chat" size={56} />
          <h2>Side chat</h2>
          <p>第一次发送时 Fork 主会话，不打断舵主。</p>
        </div>
      ) : (
        <div className="dcs-side-msgs">
          {tab.messages.map((msg, index) => (
            <MessageBlock key={index} msg={msg} />
          ))}
          {tab.listed !== null && (
            <div className="dcs-roster">
              <div className="dcs-roster-h">列出 · 全 profile 主会话</div>
              {tab.listed.map((row) => (
                <div key={row.id} className="dcs-roster-row">
                  <span className="dcs-st" data-busy={row.busy || undefined} />
                  <div className="dcs-roster-meta">
                    <div className="dcs-roster-t">{row.title}</div>
                    <div className="dcs-roster-cwd">{row.cwd}</div>
                  </div>
                  <button type="button" className="dcs-mini" onClick={() => { onIntent({ type: 'side-inspect', tabId, sessionId: row.id }) }}>
                    察看
                  </button>
                  <button type="button" className="dcs-mini" onClick={() => { deliverTo(row.id) }}>
                    投递
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab.card !== null && (
            <div className="dcs-pcard">
              <b>进度卡片 · {tab.card.title}</b>
              <div className="dcs-pcard-m">
                {tab.card.busy ? '忙' : '闲'} · turn {tab.card.turn} / step {tab.card.step}
                <br />
                {tab.card.last}
                <br />
                {tab.card.files.join(', ')}
              </div>
            </div>
          )}
          {tab.error !== null && <div className="dcs-side-err">{tab.error}</div>}
        </div>
      )}
      <div className="dcs-side-harness">
        <form
          className="dcs-harness"
          onSubmit={(event: FormEvent) => { event.preventDefault(); send() }}
        >
          <textarea
            rows={2}
            value={tab.draft}
            placeholder="不打断主会话来提问"
            onChange={(event) => { onIntent({ type: 'side-draft', tabId, text: event.target.value }) }}
            onKeyDown={onComposerKey}
          />
          <div className="dcs-harness-row">
            <button type="button" className="dcs-h-btn" title="更多" onClick={() => { setMenu((open) => !open) }}>
              <Ico name="plus" size={16} />
            </button>
            {menu && (
              <div className="dcs-plus-pop">
                <button type="button" onClick={() => { onIntent({ type: 'side-list', tabId }); setMenu(false) }}>列出</button>
                <button
                  type="button"
                  onClick={() => { onIntent({ type: 'side-inspect', tabId, sessionId: snapshot.sessionId }); setMenu(false) }}
                >
                  察看
                </button>
              </div>
            )}
            <span className="dcs-h-chip" data-ok={tab.forked || undefined}>{tab.forked ? 'Fork 已冻' : '尚未 Fork'}</span>
            <button type="submit" className="dcs-side-send" aria-label="send">
              <SendIcon />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MessageBlock({ msg }: { msg: SideChatMessage }): ReactElement {
  if (msg.kind === 'user') return <div className="dcs-s-user">{msg.text}</div>
  if (msg.kind === 'side') return <div className="dcs-s-bot">{msg.text}</div>
  if (msg.kind === 'read') {
    return (
      <div className="dcs-s-bot">
        <b>{msg.path}</b>
        <pre>{msg.text}</pre>
      </div>
    )
  }
  if (msg.kind === 'search') {
    return (
      <div className="dcs-s-bot">
        搜索 {msg.query}
        <div>{msg.hits.map((hit) => hit.path).join(', ') || '无结果'}</div>
      </div>
    )
  }
  const label = msg.status === 'sent' ? '已投递' : msg.status === 'queued' ? '已排队' : `失败 · ${msg.error}`
  return (
    <div className="dcs-delivery" data-failed={msg.status === 'failed' || undefined}>
      <div className="dcs-delivery-k">投递 · {msg.to} · {label}</div>
      {msg.text}
    </div>
  )
}

function lastUserText(tab: SideChatTabState): string {
  for (let i = tab.messages.length - 1; i >= 0; i -= 1) {
    const msg = tab.messages[i]
    if (msg?.kind === 'user') return msg.text
  }
  return ''
}

function SendIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

function ensureSideChatStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-codex-sidebar-side-css')) return
  const style = document.createElement('style')
  style.id = 'dsh-codex-sidebar-side-css'
  style.textContent = SIDE_CHAT_CSS
  document.head.appendChild(style)
}

const SIDE_CHAT_CSS = `
.dcs-side { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-layer-1); }
.dcs-side-msgs { flex: 1; overflow: auto; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.dcs-side-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--dsw-alias-label-tertiary); padding: 0 24px 12px;
}
.dcs-side-empty h2 { margin: 10px 0 0; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-secondary); letter-spacing: -0.02em; }
.dcs-side-empty p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); text-align: center; max-width: 260px; line-height: 1.45; }
.dcs-s-user { font-size: 13.5px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dcs-s-bot { font-size: 13.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dcs-s-bot pre { margin: 6px 0 0; white-space: pre-wrap; font-family: var(--ds-font-family-code); font-size: 12px; }
.dcs-roster { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; }
.dcs-roster-h { font-size: 11px; color: var(--dsw-alias-label-tertiary); padding: 8px 12px 4px; font-weight: 600; }
.dcs-roster-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dcs-roster-meta { flex: 1; min-width: 0; }
.dcs-roster-t { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dcs-roster-cwd { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.dcs-st { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); flex-shrink: 0; }
.dcs-st[data-busy] { background: var(--dsw-alias-label-secondary); }
.dcs-mini {
  font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  border-radius: 6px; padding: 2px 8px; cursor: pointer; color: var(--dsw-alias-label-primary);
}
.dcs-pcard { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 12px; font-size: 13px; }
.dcs-pcard-m { color: var(--dsw-alias-label-secondary); margin-top: 4px; font-size: 12.5px; line-height: 1.45; }
.dcs-side-err { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dcs-delivery { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; }
.dcs-delivery-k { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; font-weight: 600; }
.dcs-side-harness { padding: 8px 12px 14px; flex-shrink: 0; }
.dcs-harness { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; padding: 12px 14px 10px; }
.dcs-harness textarea {
  width: 100%; background: transparent; border: 0; color: var(--dsw-alias-label-primary);
  outline: none; font-size: 14.5px; resize: none; line-height: 1.45; min-height: 44px; font-family: inherit;
}
.dcs-harness-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; position: relative; }
.dcs-h-btn {
  width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center;
}
.dcs-h-chip { font-size: 12.5px; color: var(--dsw-alias-label-secondary); font-weight: 500; margin-left: 2px; }
.dcs-h-chip[data-ok] { color: var(--dsw-alias-label-primary); }
.dcs-side-send {
  margin-left: auto; width: 28px; height: 28px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
}
.dcs-plus-pop {
  position: absolute; bottom: 36px; left: 0; background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv2); min-width: 148px; padding: 4px; z-index: 4;
}
.dcs-plus-pop button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 8px 10px; border-radius: 7px; font-size: 13px; cursor: pointer; color: var(--dsw-alias-label-primary);
}
`
