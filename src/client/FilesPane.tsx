/** Files 工具: read-only preview + closable tree + 批注 at the mark. */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import type { DiffLine } from '../review.ts'
import type { Annotation, AnnotationRect, AnnotationTextRange, Intent, SidebarSnapshot } from '../session.ts'
import { fileCaption, parsePathLine, visibleAnnotations } from '../annotation.ts'
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
  deleteLabel,
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
  deleteLabel: string
  previewLabel: string
  diffLabel: string
}): ReactElement {
  const files = snapshot.files
  const slash = files.path.lastIndexOf('/')
  const name = slash === -1 ? files.path : files.path.slice(slash + 1)
  const image = imageSrc(files.path, files.preview)
  const markdown = image === undefined && isMarkdown(files.path)
  const missing = files.path.length > 0 && files.preview === undefined
  const tooLarge = image === undefined && isImagePath(files.path) && (files.preview?.startsWith('[File too large') ?? false)
  const empty = files.path.length === 0
  const showDiff = files.view === 'diff' && files.diff !== null
  const lines = !empty && image === undefined && !markdown && !missing && !showDiff ? (files.preview ?? '').split('\n') : []
  const tokens = lines.length > 0 ? highlightSource(files.path, files.preview ?? '') : []
  const paneMarks = visibleAnnotations(snapshot)
  const surfaceMarks = fileBadges(paneMarks, files.path)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestorsOf(files.path))
  const [query, setQuery] = useState('')

  useLayoutEffect(() => {
    const surface = bodyRef.current?.querySelector<HTMLElement>('.dcs-md') ?? null
    if (surface === null) {
      clearFileSelectionHighlight()
      return
    }
    const selections = new Map<string, AnnotationTextRange>()
    for (const mark of surfaceMarks) {
      if (mark.item.selection !== undefined) selections.set(textRangeKey(mark.item.selection), mark.item.selection)
    }
    if (files.pendingSelection !== null) selections.set(textRangeKey(files.pendingSelection), files.pendingSelection)
    showFileSelectionHighlights(
      [...selections.values()].map((selection) => restoreTextRange(surface, selection)).filter((range): range is Range => range !== null),
    )
  }, [files.path, files.pendingSelection, markdown, snapshot.attachments, snapshot.deliveredMarks])

  useEffect(() => () => { clearFileSelectionHighlight() }, [])

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

  function markSurface(event: MouseEvent<HTMLElement>): void {
    if (!files.annotate) return
    const target = event.target instanceof Element ? event.target : null
    if (target !== null && target.closest('.dcs-file-surface-badges') !== null) return
    const pane = bodyRef.current
    if (pane === null) return
    const paneBox = pane.getBoundingClientRect()
    const anchor = surfaceAnchor(event)
    showFileSelectionHighlights(anchor.range === null ? [] : [anchor.range])
    window.getSelection()?.removeAllRanges()
    onIntent({
      type: 'click-content',
      mark: `${files.path}:${anchor.line}`,
      x: event.clientX - paneBox.left,
      y: event.clientY - paneBox.top,
      rect: anchor.rect,
      ...anchor.selection === null ? {} : { selection: anchor.selection },
    })
  }

  function editMark(id: string, event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    const pane = bodyRef.current
    if (pane === null) return
    const box = pane.getBoundingClientRect()
    if (snapshot.attachments.some((item) => item.id === id)) {
      onIntent({
        type: 'edit-attachment',
        id,
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      })
      return
    }
    const delivered = snapshot.deliveredMarks.find((item) => item.id === id)
    if (delivered !== undefined) onIntent({ type: 'reveal-mark', mark: delivered })
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
            <div className="dcs-fseg" role="tablist" aria-label={previewLabel + ' / ' + diffLabel}>
              <button
                type="button"
                role="tab"
                aria-selected={files.view === 'preview'}
                data-on={files.view === 'preview' || undefined}
                onClick={() => { onIntent({ type: 'set-files-view', view: 'preview' }) }}
              >
                {previewLabel}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={files.view === 'diff'}
                data-on={files.view === 'diff' || undefined}
                onClick={() => { onIntent({ type: 'set-files-view', view: 'diff' }) }}
              >
                {diffLabel}
                {' '}
                <span className="dcs-addn">+{files.diff.added}</span>
                {' '}
                <span className="dcs-deln">−{files.diff.removed}</span>
              </button>
            </div>
          )}
          <button
            type="button"
            title={annotateLabel}
            aria-label={annotateLabel}
            className="dcs-tool"
            data-on={files.annotate || undefined}
            onClick={() => { onIntent({ type: 'set-annotate', on: !files.annotate }) }}
          >
            <Ico name="pencil" size={14} />
          </button>
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
          <div
            className="dcs-code"
            data-mark={files.annotate || undefined}
            data-selected={!markdown && image === undefined && files.pendingMark !== null || undefined}
            data-annotated={!markdown && image === undefined && surfaceMarks.length > 0 || undefined}
            data-media={image !== undefined || markdown || undefined}
          >
            {missing ? (
              <div className="dcs-missing">无法读取 {files.path}</div>
            ) : tooLarge ? (
              <div className="dcs-missing">{files.preview}</div>
            ) : image !== undefined ? (
              <div className="dcs-media-surface" data-dcs-line={1} onMouseUp={markSurface}>
                <img
                  alt={name}
                  src={image}
                  data-dcs-line={1}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 16 }}
                />
                <FileSurfaceBadges marks={surfaceMarks} pendingRect={files.pendingRect} onEdit={editMark} />
              </div>
            ) : showDiff && files.diff !== null ? (
              <FileDiffBody
                path={files.path}
                hunk={files.diff.hunk}
                lines={files.diff.lines}
                annotate={files.annotate}
                pendingMark={files.pendingMark}
                attachments={paneMarks}
                onMark={markLine}
                onEdit={editMark}
              />
            ) : markdown ? (
              <div
                className="dcs-md"
                onMouseUp={markSurface}
              >
                {renderMarkdown(files.preview ?? '')}
                <FileSurfaceBadges marks={surfaceMarks} pendingRect={files.pendingRect} onEdit={editMark} />
              </div>
            ) : (
              lines.map((line, index) => {
                const marks = lineBadges(paneMarks, files.path, index + 1)
                return (
                <div
                  key={index}
                  className="dcs-line"
                  data-annotated={marks.length > 0 || undefined}
                  data-selected={pendingLine(files.pendingMark, files.path) === index + 1 || undefined}
                  onClick={(event) => { markLine(index + 1, event) }}
                >
                  <span className="dcs-n">
                    {marks.map((mark) => (
                      <button
                        key={mark.item.id}
                        type="button"
                        className="dcs-line-badge"
                        aria-label={`编辑批注 ${mark.n}`}
                        onClick={(event) => { editMark(mark.item.id, event) }}
                      >
                        {mark.n}
                      </button>
                    ))}
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
          deleteLabel={deleteLabel}
          editing={files.editingId !== null}
          onDelete={() => {
            if (files.editingId !== null) onIntent({ type: 'remove-attachment', id: files.editingId })
          }}
          onChange={(text) => { onIntent({ type: 'set-note-draft', text }) }}
          onAdd={() => { onIntent({ type: 'note-add' }) }}
          onSend={() => { onIntent({ type: 'note-send' }) }}
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

type NumberedAnnotation = { n: number; item: Annotation }

function pendingLine(mark: string | null, path: string): number | undefined {
  if (mark === null) return undefined
  const parsed = parsePathLine(mark)
  return parsed?.path === path ? parsed.line : undefined
}

function fileBadges(attachments: readonly Annotation[], path: string): NumberedAnnotation[] {
  return attachments.flatMap((item, index) => (
    item.source === 'files' && item.path === path ? [{ n: index + 1, item }] : []
  ))
}

function lineBadges(attachments: readonly Annotation[], path: string, line: number): NumberedAnnotation[] {
  return fileBadges(attachments, path).filter((mark) => mark.item.line === line)
}

function FileSurfaceBadges({
  marks,
  pendingRect,
  onEdit,
}: {
  marks: NumberedAnnotation[]
  pendingRect: AnnotationRect | null
  onEdit: (id: string, event: MouseEvent<HTMLElement>) => void
}): ReactElement | null {
  const anchored = marks.filter((mark): mark is NumberedAnnotation & { item: Annotation & { rect: AnnotationRect } } => (
    mark.item.rect !== undefined
  ))
  if (anchored.length === 0 && pendingRect === null) return null
  return (
    <div className="dcs-file-surface-badges">
      {pendingRect !== null && (
        <span className="dcs-file-anchor-outline" data-pending style={rectStyle(pendingRect)} />
      )}
      {anchored.map((mark, index) => {
        const duplicate = anchored.slice(0, index).filter((other) => sameAnchor(other.item.rect, mark.item.rect)).length
        return (
          <span key={mark.item.id}>
            <span className="dcs-file-anchor-outline" style={rectStyle(mark.item.rect)} />
            <button
              type="button"
              className="dcs-line-badge dcs-file-anchor-badge"
              style={{ left: mark.item.rect.x + duplicate * 20, top: mark.item.rect.y }}
              aria-label={`编辑批注 ${mark.n}`}
              onClick={(event) => { onEdit(mark.item.id, event) }}
            >
              {mark.n}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function sameAnchor(a: AnnotationRect, b: AnnotationRect): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
}

function rectStyle(rect: AnnotationRect): { left: number; top: number; width: number; height: number } {
  return { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
}

const FILE_SELECTION_HIGHLIGHT = 'dcs-file-selection'

type HighlightRegistry = {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

function fileHighlightApi(): { registry: HighlightRegistry; create: (ranges: Range[]) => unknown } | null {
  const css = globalThis.CSS as unknown as { highlights?: HighlightRegistry }
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (css?.highlights === undefined || HighlightCtor === undefined) return null
  return { registry: css.highlights, create: (ranges) => new HighlightCtor(...ranges) }
}

function showFileSelectionHighlights(ranges: Range[]): void {
  const api = fileHighlightApi()
  if (api === null) return
  if (ranges.length === 0) {
    api.registry.delete(FILE_SELECTION_HIGHLIGHT)
    return
  }
  api.registry.set(FILE_SELECTION_HIGHLIGHT, api.create(ranges))
}

function clearFileSelectionHighlight(): void {
  fileHighlightApi()?.registry.delete(FILE_SELECTION_HIGHLIGHT)
}

function textRangeKey(selection: AnnotationTextRange): string {
  return `${selection.start}:${selection.end}`
}

function captureTextRange(surface: HTMLElement, range: Range): AnnotationTextRange | null {
  if (range.collapsed || !surface.contains(range.commonAncestorContainer)) return null
  const prefix = document.createRange()
  prefix.selectNodeContents(surface)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  const end = start + range.toString().length
  return end > start ? { start, end } : null
}

function restoreTextRange(surface: HTMLElement, selection: AnnotationTextRange): Range | null {
  if (selection.start < 0 || selection.end <= selection.start) return null
  const nodes: Text[] = []
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('.dcs-file-surface-badges') === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let cursor = 0
  let start: { node: Text; offset: number } | null = null
  let end: { node: Text; offset: number } | null = null
  for (const node of nodes) {
    const next = cursor + node.data.length
    if (start === null && selection.start <= next) start = { node, offset: Math.max(0, selection.start - cursor) }
    if (selection.end <= next) {
      end = { node, offset: Math.max(0, selection.end - cursor) }
      break
    }
    cursor = next
  }
  if (start === null || end === null) return null
  const range = document.createRange()
  range.setStart(start.node, Math.min(start.offset, start.node.data.length))
  range.setEnd(end.node, Math.min(end.offset, end.node.data.length))
  return range.collapsed ? null : range
}

function surfaceAnchor(event: MouseEvent<HTMLElement>): { line: number; rect: AnnotationRect; range: Range | null; selection: AnnotationTextRange | null } {
  const surface = event.currentTarget
  const target = event.target instanceof Element ? event.target : surface
  let lineElement = target.closest<HTMLElement>('[data-dcs-line]')
  let selectedRange: Range | null = null
  let targetBox = lineElement?.getBoundingClientRect() ?? target.getBoundingClientRect()

  const selection = window.getSelection()
  if (selection !== null && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    const selectedNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode
    const selectedBox = range.getBoundingClientRect()
    if (selectedNode !== null && surface.contains(selectedNode) && selectedBox.width > 0 && selectedBox.height > 0) {
      targetBox = selectedBox
      selectedRange = range.cloneRange()
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement
      lineElement = start?.closest<HTMLElement>('[data-dcs-line]') ?? lineElement
    }
  } else if (target.closest('img') !== null) {
    targetBox = new DOMRect(event.clientX, event.clientY, 2, 2)
  }

  const surfaceBox = surface.getBoundingClientRect()
  const toSurfaceRect = (box: DOMRect): AnnotationRect => ({
    x: box.left - surfaceBox.left + surface.scrollLeft,
    y: box.top - surfaceBox.top + surface.scrollTop,
    w: Math.max(2, box.width),
    h: Math.max(2, box.height),
  })
  const line = Number(lineElement?.dataset.dcsLine ?? 1)
  return {
    line: Number.isFinite(line) && line > 0 ? line : 1,
    rect: toSurfaceRect(targetBox),
    range: selectedRange,
    selection: selectedRange === null ? null : captureTextRange(surface, selectedRange),
  }
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
  pendingMark,
  attachments,
  onMark,
  onEdit,
}: {
  path: string
  hunk: string
  lines: DiffLine[]
  annotate: boolean
  pendingMark: string | null
  attachments: readonly Annotation[]
  onMark: (line: number, event: MouseEvent<HTMLElement>) => void
  onEdit: (id: string, event: MouseEvent<HTMLElement>) => void
}): ReactElement {
  return (
    <div className="dcs-fd" data-mark={annotate || undefined}>
      <div className="dcs-fd-hunk">{hunk}</div>
      {lines.map((line, index) => {
        const lineNo = line.newNo ?? line.oldNo ?? index + 1
        const marks = lineBadges(attachments, path, lineNo)
        return (
          <div
            key={index}
            className="dcs-fd-line"
            data-kind={line.kind === 'ctx' ? undefined : line.kind}
            data-annotated={marks.length > 0 || undefined}
            data-selected={pendingLine(pendingMark, path) === lineNo || undefined}
            onClick={(event) => { onMark(lineNo, event) }}
          >
            <div className="dcs-fd-ln" data-kind={line.kind === 'ctx' ? undefined : line.kind}>
              {marks.map((mark) => (
                <button
                  key={mark.item.id}
                  type="button"
                  className="dcs-line-badge"
                  aria-label={`编辑批注 ${mark.n}`}
                  onClick={(event) => { onEdit(mark.item.id, event) }}
                >
                  {mark.n}
                </button>
              ))}
              {lineNo}
            </div>
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

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
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
    return <Tag data-dcs-line={block.line}><MarkdownInlines nodes={block.inlines} /></Tag>
  }
  if (block.type === 'p') return <p data-dcs-line={block.line}><MarkdownInlines nodes={block.inlines} /></p>
  if (block.type === 'quote') return <blockquote data-dcs-line={block.line}><MarkdownInlines nodes={block.inlines} /></blockquote>
  if (block.type === 'hr') return <hr data-dcs-line={block.line} />
  if (block.type === 'code') {
    const path = block.lang.length > 0 ? `snippet.${block.lang}` : 'snippet.txt'
    const rows = highlightSource(path, block.text)
    return (
      <pre className="dcs-md-pre" data-dcs-line={block.line}>
        {block.text.split('\n').map((line, index) => (
          <div key={index} data-dcs-line={block.line + index}><CodeText tokens={rows[index]} fallback={line} /></div>
        ))}
      </pre>
    )
  }
  if (block.type === 'table') {
    return (
      <div className="dcs-md-table-wrap" data-dcs-line={block.line}>
        <table>
          <thead>
            <tr>{block.headers.map((cell, index) => <th key={index}><MarkdownInlines nodes={cell} /></th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} data-dcs-line={block.line + rowIndex + 2}>
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
    <Tag data-dcs-line={block.line}>
      {block.items.map((item, index) => <li key={index} data-dcs-line={block.line + index}><MarkdownInlines nodes={item} /></li>)}
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
