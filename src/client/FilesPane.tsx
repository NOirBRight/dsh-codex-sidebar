/** Files 工具: read-only preview + closable tree + 批注 at the mark. */

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import type { DiffLine } from '../review.ts'
import type { Annotation, Intent, SidebarSnapshot } from '../session.ts'
import { fileCaption } from '../annotation.ts'
import { ancestorsOf, visibleTree } from '../file-tree.ts'
import { highlightSource, parseMarkdown, type Inline, type MdBlock, type Token } from '../preview.ts'
import { FileGlyph, Ico } from './icons.tsx'
import { NoteComposer } from './NoteComposer.tsx'

export function FilesPane({
  snapshot,
  workspaceName,
  onIntent,
  annotateLabel,
  openTreeLabel,
  closeTreeLabel,
  notePlaceholder,
  sendLabel,
  addLabel,
  sendTip,
  previewLabel,
  diffLabel,
}: {
  snapshot: SidebarSnapshot
  workspaceName: string
  onIntent: (intent: Intent) => void
  annotateLabel: string
  openTreeLabel: string
  closeTreeLabel: string
  notePlaceholder: string
  sendLabel: string
  addLabel: string
  sendTip: string
  previewLabel: string
  diffLabel: string
}): ReactElement {
  const files = snapshot.files
  const slash = files.path.lastIndexOf('/')
  const name = slash === -1 ? files.path : files.path.slice(slash + 1)
  const image = imageSrc(files.path, files.preview)
  const markdown = image === undefined && isMarkdown(files.path)
  const missing = files.path.length > 0 && files.preview === undefined
  const empty = files.path.length === 0
  const showDiff = files.view === 'diff' && files.diff !== null
  const lines = !empty && image === undefined && !markdown && !missing && !showDiff ? (files.preview ?? '').split('\n') : []
  const tokens = lines.length > 0 ? highlightSource(files.path, files.preview ?? '') : []
  const bodyRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestorsOf(files.path))
  const [query, setQuery] = useState('')

  useEffect(() => {
    const ancestors = ancestorsOf(files.path)
    setExpanded((previous) => {
      const next = new Set(previous)
      let changed = false
      for (const path of ancestors) {
        if (next.has(path)) continue
        next.add(path)
        changed = true
      }
      return changed ? next : previous
    })
  }, [files.path])
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dragW, setDragW] = useState<number | null>(null)
  const [localW, setLocalW] = useState<number | null>(null)
  const crumbs = crumbsOf(empty ? '' : files.path)
  const treeWidth = dragW ?? localW ?? files.treeWidth ?? 240

  function startResize(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const origin = event.clientX
    const start = treeWidth
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.dataset.dragging = 'true'
    function move(next: PointerEvent<HTMLDivElement> | globalThis.PointerEvent): void {
      setDragW(Math.min(420, Math.max(160, start + (origin - next.clientX))))
    }
    function up(next: PointerEvent<HTMLDivElement> | globalThis.PointerEvent): void {
      handle.releasePointerCapture(next.pointerId)
      delete handle.dataset.dragging
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      const width = Math.min(420, Math.max(160, start + (origin - next.clientX)))
      setLocalW(width)
      setDragW(null)
      onIntent({ type: 'set-tree-width', width })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  function markLine(line: number, event: MouseEvent<HTMLElement>): void {
    if (!files.annotate) return
    const pane = bodyRef.current
    if (pane === null) return
    const box = pane.getBoundingClientRect()
    onIntent({
      type: 'click-content',
      mark: `${files.path}:${line}`,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    })
  }

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const grouped = visibleTree(files.tree, expanded, query)

  function openSearch(): void {
    if (!files.treeOpen) onIntent({ type: 'toggle-tree' })
    setSearching((on) => {
      if (on) setQuery('')
      return !on
    })
    setMenu(false)
  }

  function onCrumb(path: string, last: boolean): void {
    if (last) {
      onIntent({ type: 'select-file', path })
      return
    }
    if (!files.treeOpen) onIntent({ type: 'toggle-tree' })
    setExpanded((prev) => new Set(prev).add(path))
  }

  return (
    <div className="dcs-files" ref={bodyRef}>
      <div className="dcs-fh">
        <nav className="dcs-crumbs" aria-label="path">
          {empty ? (
            <span className="dcs-crumb-file">{workspaceName}</span>
          ) : crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <span key={crumb.path} className="dcs-crumb-wrap">
                {index > 0 && <span className="dcs-crumb-sep">/</span>}
                <button
                  type="button"
                  className={last ? 'dcs-crumb-file' : 'dcs-crumb'}
                  title={crumb.path}
                  onClick={() => { onCrumb(crumb.path, last) }}
                >
                  {crumb.name}
                </button>
              </span>
            )
          })}
        </nav>
        {searching && (
          <input
            className="dcs-fh-search"
            autoFocus
            value={query}
            placeholder="搜索文件"
            onChange={(event) => { setQuery(event.target.value) }}
          />
        )}
        <div className="dcs-fh-actions">
          {files.diff !== null && (
            <div className="dcs-fseg">
              <button
                type="button"
                data-on={files.view === 'preview' || undefined}
                onClick={() => { onIntent({ type: 'set-files-view', view: 'preview' }) }}
              >
                {previewLabel}
              </button>
              <button
                type="button"
                data-on={files.view === 'diff' || undefined}
                onClick={() => { onIntent({ type: 'set-files-view', view: 'diff' }) }}
              >
                {diffLabel}{' '}
                <span className="dcs-addn">+{files.diff.added}</span>{' '}
                <span className="dcs-deln">−{files.diff.removed}</span>
              </button>
            </div>
          )}
          <div className="dcs-fh-menu">
            <button
              type="button"
              title="菜单"
              className="dcs-tool"
              data-on={menu || undefined}
              onClick={() => { setMenu((open) => !open) }}
            >
              <Ico name="more" size={14} />
            </button>
            {menu && (
              <div className="dcs-fh-pop">
                <button
                  type="button"
                  data-on={files.annotate || undefined}
                  onClick={() => {
                    onIntent({ type: 'set-annotate', on: !files.annotate })
                    setMenu(false)
                  }}
                >
                  {annotateLabel}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            title="搜索"
            className="dcs-tool"
            data-on={searching || undefined}
            onClick={openSearch}
          >
            <Ico name="search" size={14} />
          </button>
          <button
            type="button"
            title={files.treeOpen ? closeTreeLabel : openTreeLabel}
            className="dcs-tool"
            data-on={files.treeOpen || undefined}
            onClick={() => { onIntent({ type: 'toggle-tree' }) }}
          >
            <Ico name="tree" size={14} />
          </button>
        </div>
      </div>
      <div className="dcs-files-split">
      <div className="dcs-preview" data-split={files.treeOpen || undefined}>
        {empty ? (
          <div className="dcs-files-empty">Open a file to get started</div>
        ) : (
          <div className="dcs-code" data-mark={files.annotate || undefined} data-media={image !== undefined || markdown || undefined}>
            {missing ? (
              <div className="dcs-missing">无法读取 {files.path}</div>
            ) : image !== undefined ? (
              <img
                alt={name}
                src={image}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 16 }}
                onClick={(event) => { markLine(1, event) }}
              />
            ) : showDiff && files.diff !== null ? (
              <FileDiffBody
                path={files.path}
                hunk={files.diff.hunk}
                lines={files.diff.lines}
                annotate={files.annotate}
                onMark={markLine}
              />
            ) : markdown ? (
              <div
                className="dcs-md"
                onClick={(event) => { markLine(1, event) }}
              >
                {renderMarkdown(files.preview ?? '')}
              </div>
            ) : (
              lines.map((line, index) => {
                const n = lineBadge(snapshot.attachments, files.path, index + 1)
                return (
                <div key={index} className="dcs-line" onClick={(event) => { markLine(index + 1, event) }}>
                  <span className="dcs-n">
                    {n === undefined ? null : <span className="dcs-line-badge">{n}</span>}
                    {index + 1}
                  </span>
                  <CodeText tokens={tokens[index]} fallback={line} />
                </div>
                )
              })
            )}
          </div>
        )}
      </div>
      {files.treeOpen && (
        <>
        <div
          className="dcs-tree-handle"
          title="调整目录宽度"
          onPointerDown={startResize}
        />
        <div className="dcs-tree" style={{ width: treeWidth }}>
          <div className="dcs-tree-head">
            <span className="dcs-tree-title">{workspaceName}</span>
            <button type="button" title="新建文件" className="dcs-tool" tabIndex={-1}>
              <Ico name="file-plus" size={14} />
            </button>
            <button type="button" title="新建文件夹" className="dcs-tool" tabIndex={-1}>
              <Ico name="folder-plus" size={14} />
            </button>
            <button
              type="button"
              title="刷新"
              className="dcs-tool"
              onClick={() => { onIntent({ type: 'select-file', path: files.path }) }}
            >
              <Ico name="refresh" size={14} />
            </button>
          </div>
          <div className="dcs-tree-body">
            {grouped.map((entry) => (
              entry.kind === 'dir'
                ? (
                    <button
                      key={`dir:${entry.path}`}
                      type="button"
                      className="dcs-tree-row"
                      style={{ paddingLeft: 10 + entry.depth * 12 }}
                      onClick={() => { toggleDir(entry.path) }}
                    >
                      <span className="dcs-caret" data-open={entry.open || undefined} />
                      <span className="dcs-tree-name">{entry.name}</span>
                    </button>
                  )
                : (
                    <button
                      key={`file:${entry.path}`}
                      type="button"
                      className="dcs-tree-row"
                      data-on={files.path === entry.path || undefined}
                      style={{ paddingLeft: 10 + entry.depth * 12 }}
                      onClick={() => { onIntent({ type: 'select-file', path: entry.path }) }}
                    >
                      <FileGlyph name={entry.name} />
                      <span className="dcs-tree-name">{entry.name}</span>
                    </button>
                  )
            ))}
          </div>
        </div>
        </>
      )}
      </div>
      {files.pendingMark !== null && files.notePos !== null && (
        <NoteComposer
          containerRef={bodyRef}
          anchor={files.notePos}
          value={files.noteDraft}
          objectText={fileCaption(files.pendingMark)}
          placeholder={notePlaceholder}
          sendLabel={sendLabel}
          addLabel={addLabel}
          sendTip={sendTip}
          onChange={(text) => { onIntent({ type: 'set-note-draft', text }) }}
          onAdd={() => { onIntent({ type: 'note-enter' }) }}
          onSend={() => { onIntent({ type: 'note-ctrl-enter' }) }}
          onDismiss={() => { onIntent({ type: 'dismiss-note' }) }}
        />
      )}
    </div>
  )
}

function crumbsOf(path: string): Array<{ name: string; path: string }> {
  const parts = path.split('/').filter((part) => part.length > 0)
  const absolute = path.startsWith('/')
  const out: Array<{ name: string; path: string }> = []
  let prefix = ''
  for (const part of parts) {
    prefix = prefix.length === 0 ? (absolute ? `/${part}` : part) : `${prefix}/${part}`
    out.push({ name: part, path: prefix })
  }
  return out
}

function lineBadge(attachments: readonly Annotation[], path: string, line: number): number | undefined {
  const index = attachments.findIndex((item) => (
    item.source === 'files' && item.path === path && item.line === line
  ))
  return index < 0 ? undefined : index + 1
}

function CodeText({ tokens, fallback }: { tokens: Token[] | undefined; fallback: string }): ReactElement {
  const parts = tokens && tokens.length > 0 ? tokens : [{ kind: 'text' as const, text: fallback.length === 0 ? ' ' : fallback }]
  return (
    <span className="dcs-t">
      {parts.map((tok, index) => (
        <span key={index} className={tok.kind === 'text' ? undefined : 'dcs-tok-' + tok.kind}>{tok.text}</span>
      ))}
    </span>
  )
}

function FileDiffBody({
  path,
  hunk,
  lines,
  annotate,
  onMark,
}: {
  path: string
  hunk: string
  lines: DiffLine[]
  annotate: boolean
  onMark: (line: number, event: MouseEvent<HTMLElement>) => void
}): ReactElement {
  return (
    <div className="dcs-fd" data-mark={annotate || undefined}>
      <div className="dcs-fd-hunk">{hunk}</div>
      {lines.map((line, index) => {
        const lineNo = line.newNo ?? line.oldNo ?? index + 1
        return (
          <div
            key={index}
            className="dcs-fd-line"
            data-kind={line.kind === 'ctx' ? undefined : line.kind}
            onClick={(event) => { onMark(lineNo, event) }}
          >
            <div className="dcs-fd-ln" data-kind={line.kind === 'ctx' ? undefined : line.kind}>{lineNo}</div>
            <div className="dcs-fd-sign" data-kind={line.kind === 'ctx' ? undefined : line.kind}>
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </div>
            <div className="dcs-fd-code">{line.text.length === 0 ? ' ' : line.text}</div>
          </div>
        )
      })}
    </div>
  )
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function imageSrc(path: string, preview: string | undefined): string | undefined {
  if (preview === undefined) return undefined
  if (preview.startsWith('data:image/')) return preview
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path) && preview.startsWith('data:')) return preview
  return undefined
}

function renderMarkdown(source: string): ReactNode {
  return parseMarkdown(source).map((block, index) => (
    <MarkdownBlock key={`${block.type}-${block.line}-${index}`} block={block} />
  ))
}

function MarkdownBlock({ block }: { block: MdBlock }): ReactElement {
  if (block.type === 'h') {
    const Tag = (`h${block.level}`) as 'h1' | 'h2' | 'h3'
    return <Tag><MarkdownInlines nodes={block.inlines} /></Tag>
  }
  if (block.type === 'p') return <p><MarkdownInlines nodes={block.inlines} /></p>
  if (block.type === 'quote') return <blockquote><MarkdownInlines nodes={block.inlines} /></blockquote>
  if (block.type === 'hr') return <hr />
  if (block.type === 'code') {
    const path = block.lang.length > 0 ? `snippet.${block.lang}` : 'snippet.txt'
    const rows = highlightSource(path, block.text)
    return (
      <pre className="dcs-md-pre">
        {block.text.split('\n').map((line, index) => (
          <div key={index}><CodeText tokens={rows[index]} fallback={line} /></div>
        ))}
      </pre>
    )
  }
  if (block.type === 'table') {
    return (
      <div className="dcs-md-table-wrap">
        <table>
          <thead>
            <tr>{block.headers.map((cell, index) => <th key={index}><MarkdownInlines nodes={cell} /></th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex}><MarkdownInlines nodes={cell} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const Tag = block.type === 'ol' ? 'ol' : 'ul'
  return (
    <Tag>
      {block.items.map((item, index) => <li key={index}><MarkdownInlines nodes={item} /></li>)}
    </Tag>
  )
}

function MarkdownInlines({ nodes }: { nodes: Inline[] }): ReactElement {
  return <>{nodes.map((node, index) => markdownInline(node, index))}</>
}

function markdownInline(node: Inline, index: number): ReactNode {
  if (node.kind === 'code') return <code key={index} className="dcs-md-code">{node.text}</code>
  if (node.kind === 'strong') return <strong key={index}>{node.text}</strong>
  if (node.kind === 'em') return <em key={index}>{node.text}</em>
  if (node.kind === 'link') return <a key={index} href={node.href} target="_blank" rel="noreferrer">{node.text}</a>
  return <span key={index}>{node.text}</span>
}
