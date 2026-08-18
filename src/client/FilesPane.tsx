/** Files 工具: read-only preview + closable tree + 批注 at the mark. */

import { useRef, useState, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import type { DiffLine } from '../review.ts'
import type { Annotation, Intent, SidebarSnapshot, TreeNode } from '../session.ts'
import { fileCaption } from '../annotation.ts'
import { highlightSource, type Token } from '../preview.ts'
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

  const grouped = visibleTree(files.tree, expanded, files.path, query)

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
                style={{ padding: '12px 18px', lineHeight: 1.55, fontSize: 13.5 }}
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

type TreeEntry =
  | { kind: 'dir'; path: string; name: string; depth: number; open: boolean }
  | { kind: 'file'; path: string; name: string; depth: number }

type BuiltNode = {
  path: string
  name: string
  kind: 'dir' | 'file'
  children: BuiltNode[]
}

function ancestorsOf(path: string): Set<string> {
  const open = new Set<string>()
  const parts = path.split('/').filter((part) => part.length > 0)
  const absolute = path.startsWith('/')
  let prefix = ''
  for (let index = 0; index < parts.length - 1; index += 1) {
    prefix = prefix.length === 0
      ? (absolute ? `/${parts[index]}` : (parts[index] ?? ''))
      : `${prefix}/${parts[index]}`
    if (prefix.length > 0) open.add(prefix)
  }
  return open
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

function visibleTree(
  nodes: readonly TreeNode[],
  expanded: Set<string>,
  currentPath: string,
  query: string,
): TreeEntry[] {
  const needle = query.trim().toLowerCase()
  const tree = needle.length === 0 ? buildTree(nodes) : filterTree(buildTree(nodes), needle)
  const open = new Set(expanded)
  for (const dir of ancestorsOf(currentPath)) open.add(dir)
  if (needle.length > 0) collectDirs(tree, open)
  return flatten(tree, open, 0)
}

function filterTree(nodes: readonly BuiltNode[], needle: string): BuiltNode[] {
  const out: BuiltNode[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) out.push(node)
      continue
    }
    const children = filterTree(node.children, needle)
    if (children.length > 0 || node.name.toLowerCase().includes(needle)) {
      out.push({ ...node, children })
    }
  }
  return out
}

function collectDirs(nodes: readonly BuiltNode[], open: Set<string>): void {
  for (const node of nodes) {
    if (node.kind !== 'dir') continue
    open.add(node.path)
    collectDirs(node.children, open)
  }
}

function buildTree(nodes: readonly TreeNode[]): BuiltNode[] {
  const root: BuiltNode[] = []
  const dirs = new Map<string, BuiltNode>()

  function ensureDir(path: string): BuiltNode[] {
    if (path.length === 0) return root
    const held = dirs.get(path)
    if (held !== undefined) return held.children
    const slash = path.lastIndexOf('/')
    const name = slash === -1 ? path : path.slice(slash + 1)
    const parent = slash === -1 ? '' : path.slice(0, slash)
    const node: BuiltNode = { path, name, kind: 'dir', children: [] }
    dirs.set(path, node)
    ensureDir(parent).push(node)
    return node.children
  }

  for (const node of nodes) {
    if (node.kind === 'dir') {
      ensureDir(node.path)
      continue
    }
    const slash = node.path.lastIndexOf('/')
    const parent = slash === -1 ? '' : node.path.slice(0, slash)
    ensureDir(parent).push({
      path: node.path,
      name: node.name,
      kind: 'file',
      children: [],
    })
  }

  sortLevel(root)
  return root
}

function sortLevel(list: BuiltNode[]): void {
  list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  for (const child of list) sortLevel(child.children)
}

function flatten(nodes: readonly BuiltNode[], open: Set<string>, depth: number): TreeEntry[] {
  const out: TreeEntry[] = []
  for (const node of nodes) {
    if (node.kind === 'dir') {
      const isOpen = open.has(node.path)
      out.push({ kind: 'dir', path: node.path, name: node.name, depth, open: isOpen })
      if (isOpen) out.push(...flatten(node.children, open, depth + 1))
    } else {
      out.push({ kind: 'file', path: node.path, name: node.name, depth })
    }
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
  const blocks = source.split(/\n{2,}/)
  return blocks.map((block, index) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(block)
    if (heading) {
      const text = heading[2] ?? ''
      if (heading[1] === '#') return <h1 key={index} style={{ fontSize: 22, margin: '0 0 8px' }}>{text}</h1>
      if (heading[1] === '##') return <h2 key={index} style={{ fontSize: 17, margin: '0 0 8px' }}>{text}</h2>
      return <h3 key={index} style={{ fontSize: 14, margin: '0 0 8px' }}>{text}</h3>
    }
    if (block.startsWith('```')) {
      const body = block.replace(/^```[a-z]*\n?/, '').replace(/```$/, '')
      return (
        <pre key={index} style={{ fontFamily: 'var(--ds-font-family-code)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
          {body}
        </pre>
      )
    }
    return <p key={index} style={{ margin: '0 0 10px' }}>{block}</p>
  })
}
