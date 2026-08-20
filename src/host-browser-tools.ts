/** 主会话 tools that drive Host-managed Chromium Browser Tabs. */

import { liveHref } from './browser.ts'
import { callerMayDrive, type DriveCaller, type DriveResult, type DriveTab } from './browser-drive.ts'
import type { ManagedBrowserActionResult, ManagedBrowserRuntime } from './managed-browser-runtime.ts'
import type { SidebarSession } from './session.ts'

export const BROWSER_DRIVE_TOOLS = ['browser_tabs', 'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill'] as const

export type BrowserDriveService = {
  tabs(caller: DriveCaller | undefined, session: SidebarSession): { ok: true; tabs: DriveTab[] } | DriveResult
  open(caller: DriveCaller | undefined, session: SidebarSession, url: string): Promise<{ ok: true; tab: DriveTab } | DriveResult>
  snapshot(caller: DriveCaller | undefined, session: SidebarSession, tabId?: string): Promise<DriveResult>
  click(caller: DriveCaller | undefined, session: SidebarSession, ref: string, tabId?: string): Promise<DriveResult>
  fill(caller: DriveCaller | undefined, session: SidebarSession, ref: string, text: string, tabId?: string): Promise<DriveResult>
}

export function createManagedBrowserDriveService(runtime: ManagedBrowserRuntime): BrowserDriveService {
  const guard = (caller: DriveCaller | undefined): DriveResult | undefined => callerMayDrive(caller)
    ? undefined
    : { ok: false, code: 'forbidden', message: '只有当前主会话的舵主能操作侧栏 Browser' }

  const listed = (session: SidebarSession): DriveTab[] => {
    const snapshot = session.snapshot(false)
    return snapshot.tabs.flatMap((tab) => {
      if (tab.kind !== 'Browser') return []
      const url = snapshot.browsers[tab.id]?.url || tab.target
      if (url.length === 0) return []
      const projection = runtime.projection({ sessionId: snapshot.sessionId, tabId: tab.id })
      return [{ tabId: tab.id, url: liveHref(url) ?? url, title: projection?.title || tab.title, driveable: true, connected: projection?.status === 'ready' }]
    })
  }

  const tabOf = (session: SidebarSession, tabId?: string): DriveTab | undefined => {
    const tabs = listed(session)
    if (tabId !== undefined && tabId.length > 0) return tabs.find((tab) => tab.tabId === tabId)
    const active = session.snapshot(false).active
    return tabs.find((tab) => tab.tabId === active) ?? tabs[0]
  }

  const act = async (session: SidebarSession, tabId: string | undefined, action: 'snapshot' | 'click' | 'fill', ref?: string, text?: string): Promise<DriveResult> => {
    const tab = tabOf(session, tabId)
    if (tab === undefined) return { ok: false, code: 'no-browser', message: '侧栏还没有 Browser Tab，先 browser_open 一个地址' }
    const key = { sessionId: session.snapshot(false).sessionId, tabId: tab.tabId }
    if (runtime.projection(key)?.status !== 'ready') await runtime.ensure(key, tab.url)
    if (action === 'snapshot') {
      const result = await runtime.snapshot(key)
      if ('nodes' in result) return { ok: true, snapshot: result }
      return result.ok ? { ok: true } : managedFailure(result)
    }
    const result = action === 'click' ? await runtime.click(key, ref ?? '') : await runtime.fill(key, ref ?? '', text ?? '')
    return result.ok ? { ok: true } : managedFailure(result)
  }

  return {
    tabs(caller, session) {
      const denied = guard(caller)
      return denied ?? { ok: true, tabs: listed(session) }
    },
    async open(caller, session, url) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      const href = liveHref(url)
      if (href === undefined) return { ok: false, code: 'navigation-failed', message: '需要 http 或 https 地址' }
      session.dispatch({ type: 'open-url', url: href, reveal: false })
      const tab = listed(session).find((item) => item.url === href) ?? listed(session)[0]
      if (tab === undefined) return { ok: false, code: 'no-browser', message: '无法打开 Browser Tab' }
      const projection = await runtime.ensure({ sessionId: session.snapshot(false).sessionId, tabId: tab.tabId }, href)
      if (projection.status !== 'ready') return { ok: false, code: 'navigation-failed', message: projection.error ?? '页面加载失败' }
      return { ok: true, tab: { ...tab, title: projection.title || tab.title, connected: true } }
    },
    async snapshot(caller, session, tabId) {
      const denied = guard(caller)
      return denied ?? act(session, tabId, 'snapshot')
    },
    async click(caller, session, ref, tabId) {
      const denied = guard(caller)
      return denied ?? act(session, tabId, 'click', ref)
    },
    async fill(caller, session, ref, text, tabId) {
      const denied = guard(caller)
      return denied ?? act(session, tabId, 'fill', ref, text)
    },
  }
}

function managedFailure(result: Exclude<ManagedBrowserActionResult, { ok: true }>): DriveResult {
  return { ok: false, code: result.code, message: result.message }
}
