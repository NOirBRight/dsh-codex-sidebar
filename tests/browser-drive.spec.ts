import { describe, expect, it } from 'vitest'
import {
  callerMayDrive,
  driveAct,
  formatDriveTree,
  isDriveableUrl,
  listDriveTabs,
  type DriveGuest,
  type DriveNode,
} from '../src/browser-drive.ts'
import { canonicalDriveUrl } from '../src/browser-drive.ts'
import { createHostBrowser } from '../src/host-browser.ts'
import { pickProxyPath } from '../src/browser-pick.ts'
import { createLocalPickProxy } from '../src/host-browser-proxy.ts'
import { createDriveHub } from '../src/host-browser-drive.ts'
import { BROWSER_DRIVE_TOOLS, createBrowserDriveService } from '../src/host-browser-tools.ts'
import { registerBrowserDriveTools } from '../src/register-browser-tools.ts'
import { createSidebarSession, PALETTE } from '../src/session.ts'
import type { FilesPort, PersistPort } from '../src/session.ts'
import type { BrowserPort, PageDocument } from '../src/browser.ts'

function memoryFiles(files: Record<string, string>): FilesPort {
  return {
    read(path) { return files[path] },
    tree() {
      return Object.keys(files).sort().map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
      }))
    },
  }
}

function memoryPersist(): PersistPort {
  const map = new Map<string, string>()
  return {
    load(sessionId) {
      const raw = map.get(sessionId)
      return raw === undefined ? undefined : JSON.parse(raw)
    },
    save(sessionId, snapshot) { map.set(sessionId, JSON.stringify(snapshot)) },
  }
}

const PAGE = 'http://127.0.0.1:5173/login'
const PUBLIC = 'https://www.claude.ai'

function fakeBrowser(): BrowserPort {
  const pages: Record<string, PageDocument> = {
    [PAGE]: { url: PAGE, title: 'Sign in', elements: [{ selector: 'h1', text: 'Sign in' }] },
  }
  return {
    load(url) { return pages[url] },
    openExternal() {},
    isBusy() { return false },
  }
}

function session() {
  return createSidebarSession({
    sessionId: 'sess-a',
    files: memoryFiles({ 'src/App.tsx': 'export {}' }),
    persist: memoryPersist(),
    isBusy: () => false,
    browser: fakeBrowser(),
  })
}

function nodes(): DriveNode[] {
  return [
    { ref: '@e1', role: 'heading', name: 'Sign in', selector: 'h1' },
    { ref: '@e2', role: 'button', name: 'Continue', selector: 'button.submit' },
    { ref: '@e3', role: 'textbox', name: 'email', selector: 'input[name=email]' },
  ]
}

function fakeGuest(log: string[] = []): DriveGuest {
  const catalog = nodes()
  return {
    snapshot() {
      return {
        url: PAGE,
        title: 'Sign in',
        driveable: true,
        nodes: catalog,
        text: formatDriveTree(catalog, 'Sign in'),
      }
    },
    click(ref) {
      const hit = catalog.find((node) => node.ref === ref)
      if (hit === undefined) return { ok: false as const, code: 'unknown-ref' as const }
      log.push('click:' + ref)
      return { ok: true as const }
    },
    fill(ref, text) {
      const hit = catalog.find((node) => node.ref === ref)
      if (hit === undefined) return { ok: false as const, code: 'unknown-ref' as const }
      log.push('fill:' + ref + ':' + text)
      return { ok: true as const }
    },
  }
}

describe('Browser drive seam', () => {
  it('lists Browser tabs and marks only loopback http as driveable', () => {
    const box = session()
    box.dispatch({ type: 'pick-tool', kind: 'Browser' })
    box.dispatch({ type: 'open-url', url: PAGE })
    box.dispatch({ type: 'open-url', url: PUBLIC })
    const tabs = listDriveTabs({ snapshot: box.snapshot(), connected: new Set([PAGE]) })
    expect(box.snapshot().palette).toEqual(PALETTE)
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.url).toBe(PAGE)
    expect(tabs[0]?.driveable).toBe(true)
    expect(tabs[0]?.connected).toBe(true)
    expect(tabs[1]?.url).toBe(PUBLIC)
    expect(tabs[1]?.driveable).toBe(false)
    expect(isDriveableUrl(PAGE)).toBe(true)
    expect(isDriveableUrl(PUBLIC)).toBe(false)
    expect(canonicalDriveUrl(PAGE)).toBe(canonicalDriveUrl('http://127.0.0.1:5173/login/'))
  })

  it('opens or reuses a Browser Tab and snapshots a connected loopback guest', () => {
    const box = session()
    box.dispatch({ type: 'open-url', url: PAGE })
    expect(box.snapshot().tabs).toHaveLength(1)
    box.dispatch({ type: 'open-url', url: PAGE })
    expect(box.snapshot().tabs).toHaveLength(1)
    expect(box.snapshot().browser.url).toBe(PAGE)
    const shot = driveAct({ type: 'snapshot', url: PAGE, guest: fakeGuest() })
    expect(shot.ok).toBe(true)
    if (shot.ok) {
      expect(shot.snapshot.title).toBe('Sign in')
      expect(shot.snapshot.nodes.map((node) => node.ref)).toEqual(['@e1', '@e2', '@e3'])
      expect(shot.snapshot.text).toContain('button "Continue" [ref=@e2]')
    }
  })

  it('clicks and fills by snapshot ref, and refuses public or disconnected pages', () => {
    const log: string[] = []
    const guest = fakeGuest(log)
    expect(driveAct({ type: 'click', url: PAGE, ref: '@e2', guest })).toEqual({ ok: true })
    expect(driveAct({ type: 'fill', url: PAGE, ref: '@e3', text: 'ada@local', guest })).toEqual({ ok: true })
    expect(log).toEqual(['click:@e2', 'fill:@e3:ada@local'])
    expect(driveAct({ type: 'click', url: PAGE, ref: '@missing', guest }).ok).toBe(false)
    expect(driveAct({ type: 'snapshot', url: PUBLIC, guest }).ok).toBe(false)
    expect(driveAct({ type: 'snapshot', url: PAGE }).ok).toBe(false)
  })

  it('lets only a 主会话 drive, not a Fork or subagent', () => {
    expect(callerMayDrive(undefined)).toBe(false)
    expect(callerMayDrive({})).toBe(true)
    expect(callerMayDrive({ parentSession: 'sess-a' })).toBe(false)
    expect(callerMayDrive({ origin: 'subagent' })).toBe(false)
  })
})

describe('DriveHub', () => {
  it('hands a queued command to the waiting guest and returns the reply', async () => {
    const hub = createDriveHub()
    expect(hub.connected(PAGE)).toBe(false)
    const waiting = hub.wait(PAGE)
    expect(hub.connected(PAGE)).toBe(true)
    const sent = hub.send(PAGE, { type: 'snapshot' })
    const cmd = await waiting
    expect(cmd?.type).toBe('snapshot')
    expect(cmd && cmd.id.length > 0).toBe(true)
    if (cmd === null) throw new Error('missing command')
    hub.reply(cmd.id, { ok: true, snapshot: fakeGuest().snapshot() })
    const result = await sent
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.snapshot?.title).toBe('Sign in')
  })

  it('queues concurrent fill and click until one guest consumes both in order', async () => {
    const hub = createDriveHub()
    const firstWait = hub.wait(PAGE)
    const fill = hub.send(PAGE, { type: 'fill', ref: '@e3', text: 'parallel' })
    const click = hub.send(PAGE, { type: 'click', ref: '@e2' })

    const first = await firstWait
    expect(first).toMatchObject({ type: 'fill', ref: '@e3', text: 'parallel' })
    if (first === null) throw new Error('missing first command')
    hub.reply(first.id, { ok: true })

    const second = await hub.wait(PAGE)
    expect(second).toMatchObject({ type: 'click', ref: '@e2' })
    if (second === null) throw new Error('missing second command')
    hub.reply(second.id, { ok: true })

    await expect(Promise.all([fill, click])).resolves.toEqual([{ ok: true }, { ok: true }])
  })

  it('drops a canceled long-poll waiter before serving the next guest', async () => {
    const hub = createDriveHub()
    const stale = hub.wait(PAGE)
    hub.cancelWait(PAGE)
    expect(await stale).toBeNull()
    expect(hub.connected(PAGE)).toBe(false)

    const waiting = hub.wait(PAGE)
    const sent = hub.send(PAGE, { type: 'click', ref: '@e2' })
    const cmd = await waiting
    expect(cmd?.type).toBe('click')
    if (cmd === null) throw new Error('missing command')
    hub.reply(cmd.id, { ok: true })
    await expect(sent).resolves.toEqual({ ok: true })
  })

  it('times out a send when no guest is connected', async () => {
    const hub = createDriveHub()
    const result = await hub.send(PAGE, { type: 'snapshot' }, { timeoutMs: 20 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not-connected')
  })
})

describe('BrowserDriveService', () => {
  it('lets the 主会话 open a loopback tab and refuses a Fork', () => {
    const box = session()
    const drive = createDriveHub()
    const api = createBrowserDriveService(drive)
    const opened = api.open({}, box, PAGE)
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.tab.url).toBe(PAGE)
      expect(opened.tab.driveable).toBe(true)
    }
    expect(api.tabs({ parentSession: 'other' }, box)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(api.open({ origin: 'subagent' }, box, PAGE)).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('refuses to drive a public Browser tab before contacting DriveHub', async () => {
    const box = session()
    const api = createBrowserDriveService(createDriveHub())
    expect(api.open({}, box, PUBLIC).ok).toBe(true)
    await expect(api.snapshot({}, box)).resolves.toMatchObject({ ok: false, code: 'not-loopback' })
    await expect(api.click({}, box, '@e1')).resolves.toMatchObject({ ok: false, code: 'not-loopback' })
    await expect(api.fill({}, box, '@e1', 'x')).resolves.toMatchObject({ ok: false, code: 'not-loopback' })
  })

  it('opens a loopback tab without expanding a collapsed 侧栏', () => {
    const box = session()
    expect(box.snapshot().collapsed).toBe(true)
    const api = createBrowserDriveService(createDriveHub())
    expect(api.open({}, box, PAGE).ok).toBe(true)
    expect(box.snapshot().collapsed).toBe(true)
    expect(box.snapshot().browser.url).toBe(PAGE)
    box.dispatch({ type: 'open-url', url: PAGE })
    expect(box.snapshot().collapsed).toBe(false)
  })

  it('stamps a pick-proxy frameUrl so the hidden iframe can attach drive', () => {
    const proxy = createLocalPickProxy({ listen: () => 9 })
    const box = createSidebarSession({
      sessionId: 'sess-a',
      files: memoryFiles({ 'src/App.tsx': 'export {}' }),
      persist: memoryPersist(),
      isBusy: () => false,
      browser: createHostBrowser({
        isBusy: () => false,
        pickFrameUrl: (url) => pickProxyPath(url) ?? proxy.frameUrl(url),
      }),
    })
    const opened = createBrowserDriveService(proxy.drive).open({}, box, PAGE)
    expect(opened.ok).toBe(true)
    expect(box.snapshot().browser.page?.frameUrl).toBe('/__dcs/up/127.0.0.1/5173/login')
    proxy.close()
  })

  it('denies Fork and subagent callers at both raw guard and service layers', async () => {
    type Registered = {
      name: string
      execute: (args: Record<string, unknown>, exec: { agent?: { session?: { header?: Record<string, unknown> } } }) => Promise<unknown>
    }
    const definitions = new Map<string, Registered>()
    let guard: ((exec: { name: string; agent?: { session?: { header?: Record<string, unknown> } } }) => string | undefined) | undefined
    const box = session()
    registerBrowserDriveTools(
      {
        register(definition) {
          const typed = definition as Registered
          definitions.set(typed.name, typed)
          return () => {}
        },
        guard(fn) {
          guard = fn
          return () => {}
        },
      },
      createBrowserDriveService(createDriveHub()),
      () => box,
    )
    expect(guard?.({ name: 'browser_tabs', agent: { session: { header: {} } } })).toBeUndefined()
    expect(guard?.({ name: 'browser_tabs', agent: { session: { header: { parentSession: 'root' } } } })).toContain('主会话')
    expect(guard?.({ name: 'browser_tabs', agent: { session: { header: { origin: 'subagent' } } } })).toContain('主会话')
    expect(guard?.({ name: 'other', agent: { session: { header: { origin: 'subagent' } } } })).toBeUndefined()
    await expect(definitions.get('browser_tabs')?.execute({}, {
      agent: { session: { header: { origin: 'subagent' } } },
    })).resolves.toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('registers the five 主会话 browser tools', () => {
    const names: string[] = []
    const box = session()
    registerBrowserDriveTools(
      {
        register(definition) {
          const name = (definition as { name?: string }).name
          if (name !== undefined) names.push(name)
          return () => {}
        },
      },
      createBrowserDriveService(createDriveHub()),
      () => box,
    )
    expect(names).toEqual([...BROWSER_DRIVE_TOOLS])
  })
})