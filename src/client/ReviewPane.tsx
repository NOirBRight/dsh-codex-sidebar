/** Review 工具 pane: read-only unified diff + 批注 at the gutter. */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { ReviewMode, ReviewScopeStats } from '../review.ts'
import type { Annotation, Intent, SidebarSnapshot } from '../session.ts'
import { Ico } from './icons.tsx'
import { isImeKey, useImeSafeDraft } from './ime-draft.ts'

const REVIEW_CSS = `
.dcs-rev {
  display: flex; flex-direction: column; min-height: 0; flex: 1;
  padding: 12px 14px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.dcs-rev-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; position: relative; z-index: 5; overflow: visible; }
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
  appearance: none; -webkit-appearance: none;
  font-family: inherit; color: var(--dsw-alias-label-primary);
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
.dcs-rev-line[data-annotated] { box-shadow: inset 3px 0 #38bdf8; }
.dcs-rev-gutter { display: flex; align-items: center; justify-content: center; }
.dcs-rev-badge {
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 16px;
}
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
  flex: 1; min-width: 0; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 8px 10px; font-size: 13px; outline: none;
}
.dcs-rev-note-row { display: flex; align-items: center; gap: 8px; }
.dcs-rev-add {
  flex-shrink: 0; height: 32px; padding: 0 10px; border: 0; border-radius: 6px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500;
}
.dcs-rev-add:hover { color: var(--dsw-alias-label-primary); }
.dcs-rev-delete, .dcs-rev-send {
  flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
}
.dcs-rev-delete { background: transparent; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-delete:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-send { background: var(--dsw-alias-interactive-primary); color: var(--dsw-alias-label-primary-on-color); }
.dcs-rev-dd { position: relative; min-width: 0; flex: 0 1 auto; max-width: min(280px, 52%); overflow: visible; }
.dcs-rev-dd-btn {
  border: 0; background: var(--dsw-alias-bg-layer-2); padding: 5px 8px; border-radius: 8px;
  cursor: pointer; color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family); font-size: 12.5px; font-weight: 500; line-height: 18px;
  display: inline-grid; grid-template-columns: auto auto 10px; align-items: center; gap: 8px;
  width: max-content; max-width: 100%; text-align: left;
  appearance: none; -webkit-appearance: none;
}
.dcs-rev-dd-btn:hover, .dcs-rev-dd-btn[data-open] { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-dd-btn > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-rev-dd-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; box-sizing: border-box;
  min-width: 100%; width: max-content; max-width: min(280px, 70vw); padding: 6px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px; box-shadow: var(--dsw-shadow-lv2);
  font-family: var(--dsw-font-family); font-size: 12.5px; font-weight: 500; line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
button.dcs-rev-dd-item, button.dcs-rev-dd-sub {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 100%; border: 0; background: transparent;
  padding: 7px 8px; border-radius: 7px; cursor: pointer; text-align: left;
  appearance: none; -webkit-appearance: none;
  font-family: inherit; font-size: 12.5px; font-weight: 500; line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dcs-rev-dd-sub .dcs-rev-dd-label { padding-left: 12px; color: var(--dsw-alias-label-secondary); }
button.dcs-rev-dd-item:hover, button.dcs-rev-dd-sub:hover { background: var(--dsw-alias-interactive-bg-hover); }
button.dcs-rev-dd-item[data-on], button.dcs-rev-dd-sub[data-on] { background: var(--dsw-alias-bg-layer-2); }
.dcs-rev-dd-check { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dcs-rev-dd-stat { margin: 0; font-family: var(--ds-font-family-code); font-size: 12px; white-space: nowrap; justify-self: end; }
.dcs-rev-empty { padding: 18px 8px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
`

function ensureReviewCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dcs-rev-css')) return
  const style = document.createElement('style')
  style.id = 'dcs-rev-css'
  style.textContent = REVIEW_CSS
  document.head.appendChild(style)
}

export function ReviewPane({
  snapshot,
  onIntent,
}: {
  snapshot: SidebarSnapshot
  onIntent: (intent: Intent) => void
}): ReactElement {
  ensureReviewCss()
  const review = snapshot.review
  const [hover, setHover] = useState<string | null>(null)
  const [menu, setMenu] = useState<'scope' | 'branch' | null>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const branches = review.branches ?? { current: '', names: [] }
  const branch = review.branch || branches.current
  const scopes = review.scopes ?? ZERO_SCOPES
  const mode = review.mode === 'staged' || review.mode === 'unstaged' || review.mode === 'uncommitted'
    ? review.mode
    : review.mode === 'tree' ? 'uncommitted' : 'turn'
  const scopeKey = mode === 'turn' ? 'turn' : mode

  function pick(next: ReviewMode): void {
    setMenu(null)
    onIntent({ type: 'review-switch', mode: next })
  }

  function pickBranch(name: string): void {
    setMenu(null)
    onIntent({ type: 'review-set-branch', branch: name })
  }

  useEffect(() => {
    if (menu === null) return
    const onPointer = (event: PointerEvent) => {
      if (headRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="dcs-rev">
      <div className="dcs-rev-head" ref={headRef}>
        <div className="dcs-rev-dd">
          <button
            type="button"
            className="dcs-rev-dd-btn"
            data-open={menu === 'scope' || undefined}
            aria-haspopup="menu"
            aria-expanded={menu === 'scope'}
            onClick={() => { setMenu((on) => on === 'scope' ? null : 'scope') }}
          >
            <span>{modeLabel(mode)}</span>
            <ScopeStat stat={scopes[scopeKey]} />
            <span aria-hidden="true">▾</span>
          </button>
          {menu === 'scope' && (
            <div className="dcs-rev-dd-menu" role="menu">
              <ScopeItem on={mode === 'turn'} indent={false} label="本轮变更" stat={scopes.turn} onClick={() => { pick('turn') }} />
              <ScopeItem on={mode === 'uncommitted'} indent={false} label="未提交" stat={scopes.uncommitted} onClick={() => { pick('uncommitted') }} />
              <ScopeItem on={mode === 'staged'} indent={true} label="已暂存" stat={scopes.staged} onClick={() => { pick('staged') }} />
              <ScopeItem on={mode === 'unstaged'} indent={true} label="未暂存" stat={scopes.unstaged} onClick={() => { pick('unstaged') }} />
            </div>
          )}
        </div>
        <div className="dcs-rev-dd">
          <button
            type="button"
            className="dcs-rev-dd-btn"
            data-open={menu === 'branch' || undefined}
            aria-haspopup="menu"
            aria-expanded={menu === 'branch'}
            onClick={() => { setMenu((on) => on === 'branch' ? null : 'branch') }}
          >
            <span>{branch.length > 0 ? branch : '无分支'}</span>
            <span />
            <span aria-hidden="true">▾</span>
          </button>
          {menu === 'branch' && (
            <div className="dcs-rev-dd-menu" role="menu">
              {branches.names.length === 0 && <div className="dcs-rev-empty">不是 git 仓库，没有分支可筛。</div>}
              {branches.names.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="dcs-rev-dd-item"
                  data-on={name === branch || undefined}
                  onClick={() => { pickBranch(name) }}
                >
                  <span className="dcs-rev-dd-check">{name === branch ? '✓' : ''}</span>
                  <span className="dcs-rev-dd-label">{name}{name === branches.current ? ' · 当前' : ''}</span>
                  <span />
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="dcs-rev-k" style={{ margin: 0, marginLeft: 'auto' }}>只读</span>
      </div>
      <div className="dcs-rev-list">
        {review.files.length === 0 && (
          <div className="dcs-rev-empty">{emptyHint(mode)}</div>
        )}
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
                    const stacked = reviewBadge(snapshot.attachments, mark)
                    return (
                      <div key={index}>
                        <div
                          className="dcs-rev-line"
                          data-kind={line.kind === 'ctx' ? undefined : line.kind}
                          data-annotated={stacked !== undefined || undefined}
                          onMouseEnter={() => { setHover(mark) }}
                          onMouseLeave={() => { setHover((cur) => (cur === mark ? null : cur)) }}
                        >
                          <div className="dcs-rev-gutter">
                            {stacked !== undefined ? (
                              <button
                                type="button"
                                className="dcs-rev-badge"
                                aria-label={`编辑批注 ${stacked.n}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onIntent({ type: 'edit-attachment', id: stacked.id })
                                }}
                              >
                                {stacked.n}
                              </button>
                            ) : showPlus && (
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
                          <ReviewNote
                            value={review.noteDraft}
                            editingId={review.editingId}
                            onIntent={onIntent}
                          />
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

const ZERO_SCOPES = {
  turn: { added: 0, removed: 0 },
  uncommitted: { added: 0, removed: 0 },
  staged: { added: 0, removed: 0 },
  unstaged: { added: 0, removed: 0 },
}

function modeLabel(mode: ReviewMode): string {
  if (mode === 'uncommitted' || mode === 'tree') return '未提交'
  if (mode === 'staged') return '已暂存'
  if (mode === 'unstaged') return '未暂存'
  return '本轮变更'
}

function emptyHint(mode: ReviewMode): string {
  if (mode === 'turn') return '本轮没有文件写入。'
  if (mode === 'staged') return '没有已暂存的变更。'
  if (mode === 'unstaged') return '没有未暂存的变更。'
  return '没有未提交的变更。不是 git 仓库时这里会是空的，本轮写入请切到「本轮变更」。'
}

function ScopeItem({
  on,
  indent,
  label,
  stat,
  onClick,
}: {
  on: boolean
  indent: boolean
  label: string
  stat: ReviewScopeStats
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" className={indent ? 'dcs-rev-dd-sub' : 'dcs-rev-dd-item'} data-on={on || undefined} onClick={onClick}>
      <span className="dcs-rev-dd-check">{on ? '✓' : ''}</span>
      <span className="dcs-rev-dd-label">{label}</span>
      <ScopeStat stat={stat} />
    </button>
  )
}

function ScopeStat({ stat }: { stat: ReviewScopeStats }): ReactElement {
  return (
    <span className="dcs-rev-dd-stat">
      <span className="dcs-rev-addn">+{stat.added}</span>
      {' '}
      <span className="dcs-rev-deln">−{stat.removed}</span>
    </span>
  )
}

function ReviewNote({
  value,
  editingId,
  onIntent,
}: {
  value: string
  editingId: string | null
  onIntent: (intent: Intent) => void
}): ReactElement {
  const draft = useImeSafeDraft(value, (text) => {
    onIntent({ type: 'review-set-note-draft', text })
  })

  function onNoteKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (isImeKey(event.nativeEvent)) return
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onIntent({ type: 'review-dismiss-note' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      draft.flush()
      onIntent({ type: 'review-note-add' })
    }
  }

  return (
    <div className="dcs-rev-note" onClick={(event) => { event.stopPropagation() }}>
      <div className="dcs-rev-note-row">
        <input
          autoFocus
          value={draft.value}
          placeholder="给当前会话留一条批注"
          onChange={(event) => { draft.onChange(event.target.value) }}
          onCompositionStart={draft.onCompositionStart}
          onCompositionEnd={(event) => { draft.onCompositionEnd(event.currentTarget.value) }}
          onKeyDown={onNoteKey}
        />
        {editingId !== null && (
          <button
            type="button"
            className="dcs-rev-delete"
            title="删除批注"
            aria-label="删除批注"
            onClick={() => { onIntent({ type: 'remove-attachment', id: editingId }) }}
          >
            <Ico name="trash" size={13} />
          </button>
        )}
        <button
          type="button"
          className="dcs-rev-add"
          onClick={() => {
            draft.flush()
            onIntent({ type: 'review-note-add' })
          }}
        >
          新增
        </button>
        <button
          type="button"
          className="dcs-rev-send"
          title="发送"
          aria-label="发送"
          onClick={() => {
            draft.flush()
            onIntent({ type: 'review-note-send' })
          }}
        >
          <Ico name="send" size={13} />
        </button>
      </div>
    </div>
  )
}

function reviewBadge(attachments: readonly Annotation[], mark: string): { n: number; id: string } | undefined {
  const index = attachments.findIndex((item) => item.source === 'review' && item.selector === mark)
  const item = index < 0 ? undefined : attachments[index]
  return item === undefined ? undefined : { n: index + 1, id: item.id }
}
