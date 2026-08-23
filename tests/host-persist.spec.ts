import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFilePersist, PERSIST_DEBOUNCE_MS, sidebarPersistRoot } from '../src/host-persist.ts'
import type { SidebarSnapshot } from '../src/session.ts'

function legacySnapshot(sessionId: string): SidebarSnapshot {
  return {
    sessionId,
    collapsed: true,
    tabs: [],
    active: null,
    showPalette: true,
    palette: ['Review', 'Terminal', 'Browser', 'Files'],
    files: {
      path: '', preview: undefined, tree: [], treeOpen: false, treeWidth: 240,
      view: 'preview', hunk: null, diff: null, annotate: false, pendingMark: null,
      pendingRect: null, pendingSelection: null, notePos: null, noteDraft: '', editingId: null,
    },
    fileStats: {},
    review: {
      mode: 'turn', scopes: { turn: { added: 0, removed: 0 }, uncommitted: { added: 0, removed: 0 }, staged: { added: 0, removed: 0 }, unstaged: { added: 0, removed: 0 } },
      branch: '', branches: { current: '', names: [] }, openPath: null, pendingMark: null,
      noteDraft: '', editingId: null, attachments: [], seq: 0, files: [], openDiff: null,
    },
    browser: { url: '', title: '', html: '', loading: false, error: null, canBack: false, canForward: false, history: [], historyIndex: -1, annotate: false, pendingSelector: null, pendingRect: null, pendingCaptureId: null, pendingDocumentId: null, pendingEvidence: null, notePos: null, noteDraft: '', editingId: null, attachments: [] },
    browsers: {},
    terminal: { byTab: {} },
    sideChat: { byTab: {} },
    attachments: [], deliveredMarks: [], queue: [],
  }
}

describe('sidebar host persistence', () => {
  it('resolves persistence under DSH_HOME', () => {
    expect(sidebarPersistRoot({ DSH_HOME: '/tmp/dsh-profile' })).toBe('/tmp/dsh-profile/codex-sidebar/sessions')
  })

  it('uses DSH_HOME for the default target root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-home-'))
    const legacy = join(root, 'legacy')
    const home = join(root, 'home')
    mkdirSync(legacy, { recursive: true })
    const sessionId = 'session-home'
    writeFileSync(join(legacy, sessionId + '.json'), JSON.stringify(legacySnapshot(sessionId)))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const persist = createFilePersist(undefined, legacy)
      expect(persist.load(sessionId)?.sessionId).toBe(sessionId)
      expect(existsSync(join(home, 'codex-sidebar', 'sessions', sessionId + '.json'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('copies one requested legacy session without deleting the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'dcs-persist-'))
    const target = join(root, 'target')
    const legacy = join(root, 'legacy')
    mkdirSync(legacy, { recursive: true })
    const sessionId = 'session-prod'
    const source = join(legacy, sessionId + '.json')
    writeFileSync(source, JSON.stringify(legacySnapshot(sessionId)))

    const persist = createFilePersist(target, legacy)
    expect(persist.load(sessionId)?.sessionId).toBe(sessionId)
    expect(existsSync(source)).toBe(true)
    expect(JSON.parse(readFileSync(join(target, sessionId + '.json'), 'utf8')).sessionId).toBe(sessionId)
    expect(persist.load('session-other')).toBeUndefined()

    rmSync(root, { recursive: true, force: true })
  })

  it('debounces disk writes and flushes the latest snapshot', async () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'dcs-persist-debounce-'))
    const persist = createFilePersist(root)
    const first = legacySnapshot('sess-a')
    const second = { ...first, collapsed: false }
    persist.save('sess-a', first)
    persist.save('sess-a', second)
    expect(existsSync(join(root, 'sess-a.json'))).toBe(false)
    expect(persist.load('sess-a')?.collapsed).toBe(false)
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS)
    await persist.flush()
    expect(JSON.parse(readFileSync(join(root, 'sess-a.json'), 'utf8')).collapsed).toBe(false)
    vi.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  })
})
