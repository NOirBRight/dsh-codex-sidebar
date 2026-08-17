/** Files 工具: read-only preview + closable tree + 批注 at the mark. */

import { useRef, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import type { Intent, SidebarSnapshot } from '../session.ts'
import { Ico } from './icons.tsx'

export function FilesPane({
  snapshot,
  workspaceName,
  onIntent,
  annotateLabel,
  openTreeLabel,
  closeTreeLabel,
  notePlaceholder,
}: {
  snapshot: SidebarSnapshot
  workspaceName: string
  onIntent: (intent: Intent) => void
  annotateLabel: string
  openTreeLabel: string
  closeTreeLabel: string
  notePlaceholder: string
}): ReactElement {
  const files = snapshot.files
  const slash = files.path.lastIndexOf('/')
  const dir = slash === -1 ? '' : `${files.path.slice(0, slash + 1)}`
  const name = slash === -1 ? files.path : files.path.slice(slash + 1)
  const image = imageSrc(files.path, files.preview)
  const markdown = image === undefined && isMarkdown(files.path)
  const lines = image === undefined && !markdown ? (files.preview ?? '').split('\n') : []
  const bodyRef = useRef<HTMLDivElement>(null)

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

  function onNoteKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onIntent({ type: 'dismiss-note' })
      return
    }
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      onIntent({ type: 'note-ctrl-enter' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onIntent({ type: 'note-enter' })
    }
  }

  const grouped = groupTree(files.tree)

  return (
    <div className="dcs-files" ref={bodyRef}>
      <div className="dcs-preview" data-split={files.treeOpen || undefined}>
        <div className="dcs-fh">
          <span className="dcs-path">
            {dir.length > 0 && <span className="dcs-dir">{dir}</span>}
            {name || workspaceName}
          </span>
          <button
            type="button"
            title={annotateLabel}
            className="dcs-tool"
            data-on={files.annotate || undefined}
            onClick={() => { onIntent({ type: 'set-annotate', on: !files.annotate }) }}
          >
            <Ico name="pencil" size={14} />
          </button>
          {!files.treeOpen && (
            <button type="button" title={openTreeLabel} className="dcs-tool" onClick={() => { onIntent({ type: 'toggle-tree' }) }}>
              <Ico name="tree" size={14} />
            </button>
          )}
        </div>
        <div className="dcs-code" data-mark={files.annotate || undefined} data-media={image !== undefined || markdown || undefined}>
          {image !== undefined ? (
            <img
              alt={name}
              src={image}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: 16 }}
              onClick={(event) => { markLine(1, event) }}
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
            lines.map((line, index) => (
              <div key={index} className="dcs-line" onClick={(event) => { markLine(index + 1, event) }}>
                <span className="dcs-n">{index + 1}</span>
                <span className="dcs-t">{line.length === 0 ? ' ' : line}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {files.treeOpen && (
        <div className="dcs-tree">
          <div className="dcs-fh">
            <span style={{ flex: 1 }}>{workspaceName}</span>
            <button type="button" title={closeTreeLabel} className="dcs-tool" onClick={() => { onIntent({ type: 'toggle-tree' }) }}>
              <Ico name="x" size={12} />
            </button>
          </div>
          <div className="dcs-tree-body">
            {grouped.map((entry) => (
              entry.kind === 'dir'
                ? (
                    <div key={entry.path} className="dcs-tree-folder">
                      <Ico name="folder" size={13} /> {entry.name}
                    </div>
                  )
                : (
                    <button
                      key={entry.path}
                      type="button"
                      className="dcs-tree-file"
                      data-root={entry.root || undefined}
                      data-on={files.path === entry.path || undefined}
                      onClick={() => { onIntent({ type: 'select-file', path: entry.path }) }}
                    >
                      <Ico name="file" size={13} /> {entry.name}
                    </button>
                  )
            ))}
          </div>
        </div>
      )}
      {files.pendingMark !== null && files.notePos !== null && (
        <div className="dcs-note" style={{ left: files.notePos.x, top: files.notePos.y + 12 }}>
          <input
            autoFocus
            value={files.noteDraft}
            placeholder={notePlaceholder}
            onChange={(event) => { onIntent({ type: 'set-note-draft', text: event.target.value }) }}
            onKeyDown={onNoteKey}
          />
        </div>
      )}
    </div>
  )
}

type TreeEntry =
  | { kind: 'dir'; path: string; name: string }
  | { kind: 'file'; path: string; name: string; root: boolean }

function groupTree(nodes: SidebarSnapshot['files']['tree']): TreeEntry[] {
  const seen = new Set<string>()
  const out: TreeEntry[] = []
  for (const node of nodes) {
    const slash = node.path.lastIndexOf('/')
    if (slash !== -1) {
      const dir = node.path.slice(0, slash)
      if (!seen.has(dir)) {
        seen.add(dir)
        out.push({ kind: 'dir', path: dir, name: dir })
      }
      out.push({ kind: 'file', path: node.path, name: node.name, root: false })
    } else {
      out.push({ kind: 'file', path: node.path, name: node.name, root: true })
    }
  }
  return out
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
