/** Review 工具 pane: read-only unified diff + 批注 at the gutter. */

import { useState, type KeyboardEvent, type ReactElement } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'

const REVIEW_CSS = `
.dcs-rev {
  display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1;
  padding: 12px 14px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
}
.dcs-rev-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.dcs-rev-seg {
  margin-left: auto; display: flex; background: var(--dsw-alias-bg-layer-2);
  border-radius: 8px; padding: 2px;
}
.dcs-rev-seg button {
  border: 0; background: transparent; padding: 4px 10px; border-radius: 6px;
  font-size: 11.5px; cursor: pointer; color: var(--dsw-alias-label-secondary);
}
.dcs-rev-seg button[data-on] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2);
}
.dcs-rev-k {
  font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px;
  display: flex; justify-content: space-between; padding: 0 4px; font-weight: 500; letter-spacing: .04em;
}
.dcs-rev-list { flex: 1; overflow: auto; min-height: 0; }
.dcs-rev-row {
  display: flex; align-items: baseline; gap: 8px; padding: 9px 8px; cursor: pointer;
  border-radius: 8px; width: 100%; border: 0; background: transparent; text-align: left;
  color: var(--dsw-alias-label-primary);
}
.dcs-rev-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-name { font-size: 13.5px; font-weight: 500; }
.dcs-rev-dir { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-stat { margin-left: auto; font-family: var(--ds-font-family-code); font-size: 12px; white-space: nowrap; }
.dcs-rev-addn { color: #3dd68c; } .dcs-rev-deln { color: #e85d5d; }
.dcs-rev-diff {
  font-family: var(--ds-font-family-code); font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden;
  margin: 0 4px 10px; background: var(--dsw-alias-bg-base);
}
.dcs-rev-hunk {
  padding: 5px 12px; color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2); font-size: 11px;
}
.dcs-rev-line { display: grid; grid-template-columns: 22px 34px 34px 14px 1fr; align-items: stretch; }
.dcs-rev-line[data-kind="add"] { background: color-mix(in srgb, #3dd68c 14%, transparent); }
.dcs-rev-line[data-kind="del"] { background: color-mix(in srgb, #e85d5d 14%, transparent); }
.dcs-rev-gutter { display: flex; align-items: center; justify-content: center; }
.dcs-rev-plus {
  width: 16px; height: 16px; border: 0; border-radius: 3px;
  background: #3dd68c; color: var(--dsw-alias-bg-base); cursor: pointer;
  font-size: 13px; line-height: 16px; padding: 0;
}
.dcs-rev-ln { text-align: right; padding: 3px 7px 3px 0; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-ln[data-kind="del"] { color: #e85d5d; }
.dcs-rev-ln[data-kind="add"] { color: #3dd68c; }
.dcs-rev-sign { padding-top: 3px; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-sign[data-kind="add"] { color: #3dd68c; }
.dcs-rev-sign[data-kind="del"] { color: #e85d5d; }
.dcs-rev-code { padding: 3px 8px 3px 0; white-space: pre; color: var(--dsw-alias-label-primary); }
.dcs-rev-note {
  background: var(--dsw-alias-bg-layer-1); padding: 10px 12px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dcs-rev-note input {
  width: 100%; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 8px 10px; font-size: 13px; outline: none;
}
.dcs-rev-hint { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
`

export function ReviewPane({
  snapshot,
  onIntent,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
}): ReactElement {
  const review = snapshot.review
  const [hover, setHover] = useState<string | null>(null)

  function onNoteKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onIntent({ type: 'review-dismiss-note' })
      return
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      onIntent({ type: 'review-note-ctrl-enter' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onIntent({ type: 'review-note-enter' })
    }
  }

  return (
    <div className="dcs-rev">
      <style>{REVIEW_CSS}</style>
      <div className="dcs-rev-head">
        <div className="dcs-rev-seg">
          <button
            type="button"
            data-on={review.mode === 'turn' || undefined}
            onClick={() => { onIntent({ type: 'review-switch', mode: 'turn' }) }}
          >
            本轮变更
          </button>
          <button
            type="button"
            data-on={review.mode === 'tree' || undefined}
            onClick={() => { onIntent({ type: 'review-switch', mode: 'tree' }) }}
          >
            工作区
          </button>
        </div>
      </div>
      <div className="dcs-rev-k"><span>Uncommitted</span><span>只读</span></div>
      <div className="dcs-rev-list">
        {review.files.map((file) => {
          const open = review.openDiff?.path === file.path
          return (
            <div key={file.path}>
              <button
                type="button"
                className="dcs-rev-row"
                onClick={() => { onIntent({ type: 'review-toggle-file', path: file.path }) }}
              >
                <span className="dcs-rev-name">{file.name}</span>
                {file.dir.length > 0 && <span className="dcs-rev-dir">{file.dir}</span>}
                <span className="dcs-rev-stat">
                  <span className="dcs-rev-addn">+{file.added}</span>
                  {' '}
                  <span className="dcs-rev-deln">−{file.removed}</span>
                </span>
              </button>
              {open && review.openDiff !== null && (
                <div className="dcs-rev-diff">
                  <div className="dcs-rev-hunk">{review.openDiff.hunk}</div>
                  {review.openDiff.lines.map((line, index) => {
                    const lineNo = line.newNo ?? line.oldNo
                    const mark = `${file.path}:${lineNo ?? index}`
                    const showPlus = hover === mark
                    const pending = review.pendingMark === mark
                    return (
                      <div key={index}>
                        <div
                          className="dcs-rev-line"
                          data-kind={line.kind === 'ctx' ? undefined : line.kind}
                          onMouseEnter={() => { setHover(mark) }}
                          onMouseLeave={() => { setHover((cur) => (cur === mark ? null : cur)) }}
                        >
                          <div className="dcs-rev-gutter">
                            {showPlus && (
                              <button
                                type="button"
                                className="dcs-rev-plus"
                                title="批注此行"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onIntent({ type: 'review-gutter', mark })
                                }}
                              >
                                +
                              </button>
                            )}
                          </div>
                          <div className="dcs-rev-ln" data-kind={line.kind === 'del' ? 'del' : undefined}>
                            {line.oldNo ?? ''}
                          </div>
                          <div className="dcs-rev-ln" data-kind={line.kind === 'add' ? 'add' : undefined}>
                            {line.newNo ?? ''}
                          </div>
                          <div className="dcs-rev-sign" data-kind={line.kind === 'ctx' ? undefined : line.kind}>
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                          </div>
                          <div className="dcs-rev-code">{line.text.length === 0 ? ' ' : line.text}</div>
                        </div>
                        {pending && (
                          <div className="dcs-rev-note" onClick={(event) => { event.stopPropagation() }}>
                            <input
                              autoFocus
                              value={review.noteDraft}
                              placeholder="批注给舵主"
                              onChange={(event) => {
                                onIntent({ type: 'review-set-note-draft', text: event.target.value })
                              }}
                              onKeyDown={onNoteKey}
                            />
                            <div className="dcs-rev-hint">Enter 堆叠 · Ctrl+Enter 发给主会话 · Esc 取消</div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
