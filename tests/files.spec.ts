import { describe, expect, it } from 'vitest'
import { visibleTree } from '../src/file-tree.ts'
import { createSidebarSession, MAX_DELIVERED_MARKS, PALETTE } from '../src/session.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'

function memoryFiles(
  files: Record<string, string>,
  changes?: Record<string, { before: string; after: string }>,
): FilesPort {
  return {
    read(path) {
      return files[path]
    },
    tree() {
      return Object.keys(files).sort().map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
      }))
    },
    ...(changes === undefined ? {} : {
      change(path: string) {
        return changes[path]
      },
    }),
  }
}

function memoryPersist(): PersistPort & { dump(): Map<string, string> } {
  const map = new Map<string, string>()
  return {
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    save(sessionId, snapshot) {
      map.set(sessionId, JSON.stringify(snapshot))
    },
    dump: () => map,
  }
}

function session(opts?: { busy?: boolean; persist?: PersistPort; id?: string }) {
  let busy = opts?.busy ?? false
  const persist = opts?.persist ?? memoryPersist()
  const files = memoryFiles({
    'src/Login.tsx': 'export function Login() {\n  return <h1>Sign in</h1>\n}',
    'README.md': '# foo\n',
  })
  const box = createSidebarSession({
    sessionId: opts?.id ?? 'sess-a',
    files,
    persist,
    isBusy: () => busy,
  })
  return {
    box,
    setBusy(next: boolean) {
      busy = next
    },
    persist,
  }
}

describe('Files seam', () => {
  it('shows the Palette until a 工具 is chosen, then Files fills the Tab', () => {
    const { box } = session()
    const empty = box.snapshot()
    expect(empty.collapsed).toBe(true)
    expect(empty.tabs).toEqual([])
    expect(empty.palette).toEqual(PALETTE)
    expect(empty.showPalette).toBe(true)

    const effects = box.dispatch({ type: 'pick-tool', kind: 'Files' })
    expect(effects).toEqual([])
    const filled = box.snapshot()
    expect(filled.collapsed).toBe(false)
    expect(filled.showPalette).toBe(false)
    expect(filled.tabs).toHaveLength(1)
    expect(filled.tabs[0]?.kind).toBe('Files')
    expect(filled.active).toBe(filled.tabs[0]?.id)
  })

  it('opens a new empty Tab with +, then filling it replaces the Palette', () => {
    const { box } = session()
    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    box.dispatch({ type: 'open-empty-tab' })
    const snap = box.snapshot()
    expect(snap.tabs).toHaveLength(2)
    expect(snap.tabs[1]?.kind).toBeNull()
    expect(snap.showPalette).toBe(true)
    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    expect(box.snapshot().tabs[1]?.kind).toBe('Files')
    expect(box.snapshot().showPalette).toBe(false)
  })

  it('picking a 工具 while a Tab is already filled opens another filled Tab', () => {
    const { box } = session()
    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    box.dispatch({ type: 'pick-tool', kind: 'Terminal' })
    const snap = box.snapshot()
    expect(snap.tabs).toHaveLength(2)
    expect(snap.tabs[0]?.kind).toBe('Files')
    expect(snap.tabs[1]?.kind).toBe('Terminal')
    expect(snap.active).toBe(snap.tabs[1]?.id)
    expect(snap.showPalette).toBe(false)
  })

  it('hides the 侧栏 when the last Tab closes, and keeps Tabs when only toggled', () => {
    const { box } = session()
    box.dispatch({ type: 'pick-tool', kind: 'Files' })
    const id = box.snapshot().tabs[0]?.id as string
    box.dispatch({ type: 'toggle-collapsed' })
    expect(box.snapshot().collapsed).toBe(true)
    expect(box.snapshot().tabs).toHaveLength(1)
    box.dispatch({ type: 'toggle-collapsed' })
    expect(box.snapshot().collapsed).toBe(false)
    box.dispatch({ type: 'close-tab', id })
    expect(box.snapshot().collapsed).toBe(true)
    expect(box.snapshot().tabs).toEqual([])
  })

  it('expands on a path click, reuses the same Files Tab, and opens a new Tab for a different path', () => {
    const { box } = session()
    box.dispatch({ type: 'toggle-collapsed' })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const first = box.snapshot()
    expect(first.collapsed).toBe(false)
    expect(first.tabs).toHaveLength(1)
    expect(first.tabs[0]?.kind).toBe('Files')
    expect(first.tabs[0]?.target).toBe('src/Login.tsx')
    expect(first.files.path).toBe('src/Login.tsx')
    expect(first.files.preview).toContain('Sign in')

    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    expect(box.snapshot().tabs).toHaveLength(1)

    box.dispatch({ type: 'open-path', path: 'README.md' })
    const two = box.snapshot()
    expect(two.tabs).toHaveLength(2)
    expect(two.tabs[1]?.target).toBe('README.md')
    expect(two.files.preview).toBe('# foo\n')
  })

  it('opens a tree file in a new Tab and reuses it on later clicks', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const loginTab = box.snapshot().active

    box.dispatch({ type: 'select-file', path: 'README.md' })
    const readme = box.snapshot()
    expect(readme.tabs).toHaveLength(2)
    expect(readme.tabs[0]).toMatchObject({ id: loginTab, kind: 'Files', target: 'src/Login.tsx' })
    expect(readme.tabs[1]).toMatchObject({ kind: 'Files', target: 'README.md' })
    expect(readme.active).toBe(readme.tabs[1]?.id)
    expect(readme.files.path).toBe('README.md')

    box.dispatch({ type: 'select-file', path: 'src/Login.tsx' })
    const reused = box.snapshot()
    expect(reused.tabs).toHaveLength(2)
    expect(reused.active).toBe(loginTab)
    expect(reused.files.path).toBe('src/Login.tsx')
  })

  it('previews an absolute path even when it is outside the workspace tree', () => {
    const files = memoryFiles({
      'src/Login.tsx': 'export function Login() {}\n',
      '/other/repo/index.ts': 'export const n = 1\n',
    })
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: memoryPersist(),
      isBusy: () => false,
    })
    box.dispatch({ type: 'open-path', path: '/other/repo/index.ts' })
    expect(box.snapshot().files.path).toBe('/other/repo/index.ts')
    expect(box.snapshot().files.preview).toBe('export const n = 1\n')
  })

  it('reuses a Files Tab even when the active Tab is empty, and restores preview on select', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'open-path', path: 'README.md' })
    box.dispatch({ type: 'select-tab', id: box.snapshot().tabs[0]?.id as string })
    expect(box.snapshot().files.path).toBe('src/Login.tsx')
    expect(box.snapshot().files.preview).toContain('Sign in')

    box.dispatch({ type: 'open-empty-tab' })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    const snap = box.snapshot()
    expect(snap.tabs.filter((tab) => tab.kind === 'Files' && tab.target === 'src/Login.tsx')).toHaveLength(1)
    expect(snap.active).toBe(snap.tabs[0]?.id)
    expect(snap.files.path).toBe('src/Login.tsx')
  })

  it('does not write file bytes through any Files intent', () => {
    const files = memoryFiles({ 'src/Login.tsx': 'original' })
    const persist = memoryPersist()
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist,
      isBusy: () => false,
    })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'select-file', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 10, y: 20 })
    box.dispatch({ type: 'note-add' })
    expect(files.read('src/Login.tsx')).toBe('original')
  })

  it('shows the 批注 composer only after a content click, moves it, and Esc dismisses', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    expect(box.snapshot().files.pendingMark).toBeNull()
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:2', x: 12, y: 40 })
    expect(box.snapshot().files.pendingMark).toBe('src/Login.tsx:2')
    expect(box.snapshot().files.notePos).toEqual({ x: 12, y: 40 })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:3', x: 80, y: 90 })
    expect(box.snapshot().files.pendingMark).toBe('src/Login.tsx:3')
    expect(box.snapshot().files.notePos).toEqual({ x: 80, y: 90 })
    box.dispatch({ type: 'dismiss-note' })
    expect(box.snapshot().files.pendingMark).toBeNull()
    expect(box.snapshot().files.notePos).toBeNull()
  })

  it('adds one 批注 and directly sends only the next one', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    box.dispatch({ type: 'set-note-draft', text: 'make the heading larger' })
    expect(box.dispatch({ type: 'note-add' })).toEqual([])
    expect(box.snapshot().attachments).toEqual([
      {
        id: 't2',
        text: 'make the heading larger',
        from: 'Login.tsx:1',
        source: 'files',
        selector: 'src/Login.tsx:1',
        path: 'src/Login.tsx',
        line: 1,
      },
    ])
    expect(box.snapshot().files.pendingMark).toBeNull()

    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:2', x: 2, y: 2 })
    box.dispatch({ type: 'set-note-draft', text: 'and the button' })
    const sent = box.dispatch({ type: 'note-send' })
    expect(sent).toEqual([{
      type: 'send',
      text: 'and the button',
      attachments: [{
        id: 't3',
        text: 'and the button',
        from: 'Login.tsx:2',
        source: 'files',
        selector: 'src/Login.tsx:2',
        path: 'src/Login.tsx',
        line: 2,
      }],
    }])
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]?.id).toBe('t2')
  })

  it('directly sends only the current 批注 and leaves stacked 批注 in the composer', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    box.dispatch({ type: 'set-note-draft', text: 'keep this stacked' })
    box.dispatch({ type: 'note-add' })

    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:2', x: 2, y: 2 })
    box.dispatch({ type: 'set-note-draft', text: 'send only this' })
    expect(box.dispatch({ type: 'note-send' })).toEqual([{
      type: 'send',
      text: 'send only this',
      attachments: [{
        id: 't3',
        text: 'send only this',
        from: 'Login.tsx:2',
        source: 'files',
        selector: 'src/Login.tsx:2',
        path: 'src/Login.tsx',
        line: 2,
      }],
    }])
    expect(box.snapshot().attachments.map((item) => item.text)).toEqual(['keep this stacked'])
  })

  it('persists a file surface rectangle and re-anchors the same 批注 while editing', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'README.md' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({
      type: 'click-content',
      mark: 'README.md:3',
      x: 40,
      y: 50,
      rect: { x: 20, y: 80, w: 120, h: 24 },
      selection: { start: 15, end: 34 },
    })
    box.dispatch({ type: 'set-note-draft', text: 'move with this paragraph' })
    box.dispatch({ type: 'note-add' })
    const id = box.snapshot().attachments[0]?.id as string
    expect(box.snapshot().attachments[0]).toMatchObject({
      id,
      path: 'README.md',
      line: 3,
      rect: { x: 20, y: 80, w: 120, h: 24 },
      selection: { start: 15, end: 34 },
    })

    box.dispatch({ type: 'edit-attachment', id })
    expect(box.snapshot().files.pendingRect).toEqual({ x: 20, y: 80, w: 120, h: 24 })
    expect(box.snapshot().files.pendingSelection).toEqual({ start: 15, end: 34 })
    box.dispatch({
      type: 'click-content',
      mark: 'README.md:7',
      x: 60,
      y: 70,
      rect: { x: 44, y: 180, w: 180, h: 36 },
    })
    expect(box.snapshot().files.editingId).toBe(id)
    expect(box.snapshot().files.noteDraft).toBe('move with this paragraph')
    box.dispatch({ type: 'note-add' })
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]).toMatchObject({
      id,
      path: 'README.md',
      line: 7,
      rect: { x: 44, y: 180, w: 180, h: 36 },
    })
  })

  it('opens a stacked file 批注 for editing, updates it in place, and removes it from the editor', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:2', x: 4, y: 5 })
    box.dispatch({ type: 'set-note-draft', text: 'old copy' })
    box.dispatch({ type: 'note-add' })
    const id = box.snapshot().attachments[0]?.id as string

    box.dispatch({ type: 'toggle-collapsed' })
    box.dispatch({ type: 'edit-attachment', id })
    expect(box.snapshot().collapsed).toBe(false)
    expect(box.snapshot().files).toMatchObject({
      path: 'src/Login.tsx',
      annotate: true,
      pendingMark: 'src/Login.tsx:2',
      noteDraft: 'old copy',
      editingId: id,
    })
    box.dispatch({ type: 'set-note-draft', text: 'new copy' })
    box.dispatch({ type: 'note-add' })
    expect(box.snapshot().attachments).toHaveLength(1)
    expect(box.snapshot().attachments[0]).toMatchObject({ id, text: 'new copy' })

    box.dispatch({ type: 'edit-attachment', id })
    box.dispatch({ type: 'remove-attachment', id })
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().files.editingId).toBeNull()
    expect(box.snapshot().files.pendingMark).toBeNull()
  })

  it('sends stacked 批注 with an empty composer draft', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    box.dispatch({ type: 'note-add' })
    const stacked = box.snapshot().attachments
    expect(box.dispatch({ type: 'composer-send', text: '' })).toEqual([{
      type: 'send',
      text: '',
      attachments: stacked,
    }])
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().deliveredMarks).toEqual(stacked)
  })

  it('reveals a delivered file mark without putting it back in the composer', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    box.dispatch({ type: 'set-note-draft', text: 'heading' })
    box.dispatch({ type: 'note-send' })
    const mark = box.snapshot().deliveredMarks[0]
    expect(mark?.path).toBe('src/Login.tsx')
    box.dispatch({ type: 'toggle-collapsed' })
    box.dispatch({ type: 'reveal-mark', mark: mark! })
    expect(box.snapshot().collapsed).toBe(false)
    expect(box.snapshot().attachments).toEqual([])
    expect(box.snapshot().files).toMatchObject({
      path: 'src/Login.tsx',
      annotate: true,
      pendingMark: 'src/Login.tsx:1',
      editingId: null,
      noteDraft: '',
      notePos: null,
    })
  })

  it('keeps only the most recent delivered marks', () => {
    const { box } = session()
    for (let i = 1; i <= MAX_DELIVERED_MARKS + 5; i += 1) {
      box.dispatch({
        type: 'restore-attachments',
        attachments: [{ id: 'd' + i, text: 'n', from: 'f', source: 'files', path: 'src/Login.tsx', line: 1 }],
      })
      box.dispatch({ type: 'composer-send', text: 'x' })
    }
    const marks = box.snapshot().deliveredMarks
    expect(marks).toHaveLength(MAX_DELIVERED_MARKS)
    expect(marks[0]?.id).toBe('d6')
    expect(marks[marks.length - 1]?.id).toBe('d' + String(MAX_DELIVERED_MARKS + 5))
  })

  it('keeps an empty composer send inert when there are no 批注', () => {
    const { box } = session()
    expect(box.dispatch({ type: 'composer-send', text: '' })).toEqual([])
  })

  it('queues 批注 the same way as a composer send when the 主会话 is busy', () => {
    const { box, setBusy } = session()
    setBusy(true)
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    const queued = box.dispatch({ type: 'note-send' })
    expect(queued[0]?.type).toBe('queue')
    expect(box.snapshot().queue).toHaveLength(1)
    const again = box.dispatch({ type: 'composer-send', text: 'follow up' })
    expect(again).toEqual([{ type: 'queue', text: 'follow up', attachments: [] }])
  })

  it('drops a stacked 批注 from the 主会话 chips', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'set-annotate', on: true })
    box.dispatch({ type: 'click-content', mark: 'src/Login.tsx:1', x: 1, y: 1 })
    box.dispatch({ type: 'set-note-draft', text: 'make the heading larger' })
    box.dispatch({ type: 'note-add' })
    expect(box.dispatch({ type: 'remove-attachment', id: 't2' })).toEqual([])
    expect(box.snapshot().attachments).toEqual([])
  })

  it('collapses a directory even when it contains the current file', () => {
    const currentPath = '.agents/skills/find-skills/SKILL.md'
    const tree = [
      { path: currentPath, name: 'SKILL.md' },
      { path: '.agents/skills/other/SKILL.md', name: 'SKILL.md' },
    ]
    const expanded = new Set(['.agents', '.agents/skills', '.agents/skills/find-skills'])
    expect(visibleTree(tree, expanded, '').some((entry) => entry.path === currentPath)).toBe(true)

    expanded.delete('.agents/skills/find-skills')
    const collapsed = visibleTree(tree, expanded, '')
    expect(collapsed.find((entry) => entry.path === '.agents/skills/find-skills')).toMatchObject({ open: false })
    expect(collapsed.some((entry) => entry.path === currentPath)).toBe(false)
  })

  it('keeps the tree closed when a path opens, and remembers a dragged width', () => {
    const { box } = session()
    expect(box.snapshot().files.treeOpen).toBe(false)
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    expect(box.snapshot().files.treeOpen).toBe(false)
    box.dispatch({ type: 'toggle-tree' })
    expect(box.snapshot().files.treeOpen).toBe(true)
    box.dispatch({ type: 'set-tree-width', width: 300 })
    expect(box.snapshot().files.treeWidth).toBe(300)
    box.dispatch({ type: 'open-path', path: 'README.md' })
    expect(box.snapshot().files.treeOpen).toBe(false)
    expect(box.snapshot().files.treeWidth).toBe(300)
  })

  it('exposes a working-tree diff for an edited file and can switch back to preview', () => {
    const persist = memoryPersist()
    const files = memoryFiles(
      { 'src/Login.tsx': 'export function Login() {\n  return <h1>Sign in</h1>\n}' },
      {
        'src/Login.tsx': {
          before: 'export function Login() {\n  return <button>OK</button>\n}',
          after: 'export function Login() {\n  return <h1>Sign in</h1>\n}',
        },
      },
    )
    const box = createSidebarSession({ sessionId: 'sess-a', files, persist, isBusy: () => false })
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    expect(box.snapshot().files.view).toBe('preview')
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx', view: 'diff' })
    const opened = box.snapshot().files
    expect(opened.view).toBe('diff')
    expect(opened.diff?.added).toBe(1)
    expect(opened.diff?.removed).toBe(1)
    box.dispatch({ type: 'set-files-view', view: 'preview' })
    expect(box.snapshot().files.view).toBe('preview')
  })

  it('opens an edit tool hunk so the Files diff keeps deletions', () => {
    const persist = memoryPersist()
    const files = memoryFiles({ 'a.ts': 'new file\n' })
    const box = createSidebarSession({ sessionId: 'sess-a', files, persist, isBusy: () => false })
    box.dispatch({
      type: 'open-path',
      path: 'a.ts',
      view: 'diff',
      before: 'old line\nkeep\n',
      after: 'new line\nkeep\n',
    })
    const diff = box.snapshot().files.diff
    expect(diff?.removed).toBe(1)
    expect(diff?.added).toBe(1)
    expect(diff?.lines.some((line) => line.kind === 'del' && line.text.includes('old line'))).toBe(true)
  })

  it('persists a bounded explicit Files hunk for reload', () => {
    const persist = memoryPersist()
    const files = memoryFiles({ 'deleted.ts': 'new\n' })
    const box = createSidebarSession({ sessionId: 'sess-hunk', files, persist, isBusy: () => false })
    box.dispatch({ type: 'open-path', path: 'deleted.ts', view: 'diff', before: 'old\n', after: 'new\n' })

    const reloaded = createSidebarSession({ sessionId: 'sess-hunk', files, persist, isBusy: () => false })
    const snapshot = reloaded.snapshot()
    expect(snapshot.files.hunk).toEqual({ before: 'old\n', after: 'new\n' })
    expect(snapshot.files.diff?.removed).toBe(1)
    expect(snapshot.files.diff?.added).toBe(1)
  })

  it('persists the Tab strip with the 主会话 and isolates another 主会话', () => {
    const persist = memoryPersist()
    const files = memoryFiles({ 'src/Login.tsx': 'ok', 'README.md': '# foo\n' })
    const a = createSidebarSession({ sessionId: 'sess-a', files, persist, isBusy: () => false })
    a.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    a.dispatch({ type: 'toggle-collapsed' })

    const a2 = createSidebarSession({ sessionId: 'sess-a', files, persist, isBusy: () => false })
    expect(a2.snapshot().collapsed).toBe(true)
    expect(a2.snapshot().tabs[0]?.target).toBe('src/Login.tsx')

    const b = createSidebarSession({ sessionId: 'sess-b', files, persist, isBusy: () => false })
    expect(b.snapshot().tabs).toEqual([])
    expect(b.snapshot().collapsed).toBe(true)
  })

  it('keeps image data URLs and markdown source in the Files preview', () => {
    const png = 'data:image/png;base64,aaa'
    const files = memoryFiles({
      'docs/logo.png': png,
      'docs/note.md': '# Title\n\nhello',
    })
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files,
      persist: memoryPersist(),
      isBusy: () => false,
    })
    box.dispatch({ type: 'open-path', path: 'docs/logo.png' })
    expect(box.snapshot().files.preview).toBe(png)
    box.dispatch({ type: 'open-path', path: 'docs/note.md' })
    expect(box.snapshot().files.preview).toBe('# Title\n\nhello')
    expect(box.snapshot().tabs).toHaveLength(2)
  })

  it('reorders Tabs and keeps the active id', () => {
    const { box } = session()
    box.dispatch({ type: 'open-path', path: 'src/Login.tsx' })
    box.dispatch({ type: 'open-path', path: 'README.md' })
    const [first, second] = box.snapshot().tabs.map((tab) => tab.id)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    box.dispatch({ type: 'reorder-tabs', from: 0, to: 1 })
    expect(box.snapshot().tabs.map((tab) => tab.id)).toEqual([second, first])
    expect(box.snapshot().active).toBe(second)
    box.dispatch({ type: 'reorder-tabs', from: 0, to: 0 })
    box.dispatch({ type: 'reorder-tabs', from: -1, to: 0 })
    box.dispatch({ type: 'reorder-tabs', from: 0, to: 9 })
    expect(box.snapshot().tabs.map((tab) => tab.id)).toEqual([second, first])
  })
})
