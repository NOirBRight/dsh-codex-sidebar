/** 主会话 tools that drive the visible Browser Tab on loopback pages. */

import { liveHref } from './browser.ts'
import { liveUrlFromFrameSrc } from './browser-pick.ts'
import {
  callerMayDrive,
  isDriveableUrl,
  listDriveTabs,
  type DriveCaller,
  type DriveResult,
  type DriveTab,
} from './browser-drive.ts'
import type { DriveHub, DriveRequest } from './host-browser-drive.ts'
import type { SidebarSession } from './session.ts'

export const BROWSER_DRIVE_TOOLS = [
  'browser_tabs',
  'browser_open',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
] as const

export type BrowserDriveService = {
  tabs(caller: DriveCaller | undefined, session: SidebarSession): { ok: true; tabs: DriveTab[] } | DriveResult
  open(caller: DriveCaller | undefined, session: SidebarSession, url: string): { ok: true; tab: DriveTab } | DriveResult
  snapshot(caller: DriveCaller | undefined, session: SidebarSession, tabId?: string): Promise<DriveResult>
  click(caller: DriveCaller | undefined, session: SidebarSession, ref: string, tabId?: string): Promise<DriveResult>
  fill(caller: DriveCaller | undefined, session: SidebarSession, ref: string, text: string, tabId?: string): Promise<DriveResult>
}

export function createBrowserDriveService(drive: DriveHub): BrowserDriveService {
  function guard(caller: DriveCaller | undefined): DriveResult | undefined {
    if (callerMayDrive(caller)) return undefined
    return { ok: false, code: 'forbidden', message: '只有当前主会话的舵主能操作侧栏 Browser' }
  }

  function listed(session: SidebarSession): DriveTab[] {
    return listDriveTabs({
      snapshot: session.snapshot(),
      connected: new Set(drive.connectedUrls()),
    })
  }

  function tabOf(session: SidebarSession, tabId?: string): DriveTab | undefined {
    const tabs = listed(session)
    if (tabId !== undefined && tabId.length > 0) return tabs.find((tab) => tab.tabId === tabId)
    const box = session.snapshot()
    return tabs.find((tab) => tab.tabId === box.active) ?? tabs[0]
  }

  async function act(session: SidebarSession, tabId: string | undefined, request: DriveRequest): Promise<DriveResult> {
    const tab = tabOf(session, tabId)
    if (tab === undefined) {
      return { ok: false, code: 'no-browser', message: '侧栏还没有 Browser Tab，先 browser_open 一个本机地址' }
    }
    if (!isDriveableUrl(tab.url)) {
      return { ok: false, code: 'not-loopback', message: '只有本机 http 页面能给舵主操作，这个地址不行' }
    }
    const remote = await drive.send(tab.url, request, { timeoutMs: request.type === 'snapshot' ? 8_000 : 12_000 })
    if (!remote.ok && remote.code === 'not-connected') {
      return {
        ...remote,
        message: remote.message + ' frameUrl=' + (tab.frameUrl ?? 'none') + ' guests=' + (drive.connectedUrls().join(',') || 'none'),
      }
    }
    if (remote.ok && remote.snapshot !== undefined) {
      const live = liveUrlFromFrameSrc(remote.snapshot.url) ?? remote.snapshot.url
      return { ok: true, snapshot: { ...remote.snapshot, url: live } }
    }
    return remote
  }

  return {
    tabs(caller, session) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      return { ok: true, tabs: listed(session) }
    },
    open(caller, session, url) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      const href = liveHref(url)
      if (href === undefined) {
        return { ok: false, code: 'not-loopback', message: '需要 http 或 https 地址' }
      }
      session.dispatch({ type: 'open-url', url: href, reveal: false })
      const tab = listed(session).find((item) => item.url === href) ?? listed(session)[0]
      if (tab === undefined) {
        return { ok: false, code: 'no-browser', message: '无法打开 Browser Tab' }
      }
      return { ok: true, tab }
    },
    async snapshot(caller, session, tabId) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      return act(session, tabId, { type: 'snapshot' })
    },
    async click(caller, session, ref, tabId) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      return act(session, tabId, { type: 'click', ref })
    },
    async fill(caller, session, ref, text, tabId) {
      const denied = guard(caller)
      if (denied !== undefined) return denied
      return act(session, tabId, { type: 'fill', ref, text })
    },
  }
}
