/** Agent drive of the human Browser Tab. Loopback http only. */

import { isLoopbackHttpUrl } from './browser-pick.ts'
import { normalizeUrl } from './browser.ts'
import type { SidebarSnapshot } from './session.ts'

export type DriveRef = string

export type DriveNode = {
  ref: DriveRef
  role: string
  name: string
  selector: string
}

export type DriveSnapshot = {
  url: string
  title: string
  driveable: true
  nodes: DriveNode[]
  text: string
}

export type DriveTab = {
  tabId: string
  url: string
  title: string
  driveable: boolean
  connected: boolean
  frameUrl?: string
}

export type DriveErrorCode = 'not-loopback' | 'not-connected' | 'unknown-ref' | 'no-browser' | 'forbidden'

export type DriveFailure = {
  ok: false
  code: DriveErrorCode
  message: string
}

export type DriveSuccess = {
  ok: true
  snapshot?: DriveSnapshot
}

export type DriveResult = DriveSuccess | DriveFailure

export type DriveGuest = {
  snapshot(): DriveSnapshot
  click(ref: DriveRef): { ok: true } | { ok: false; code: 'unknown-ref' }
  fill(ref: DriveRef, text: string): { ok: true } | { ok: false; code: 'unknown-ref' }
}

export type DriveCaller = {
  parentSession?: string
  origin?: string
}

export type DriveAction =
  | { type: 'snapshot'; url: string; guest?: DriveGuest }
  | { type: 'click'; url: string; ref: DriveRef; guest?: DriveGuest }
  | { type: 'fill'; url: string; ref: DriveRef; text: string; guest?: DriveGuest }

export function isDriveableUrl(url: string): boolean {
  return isLoopbackHttpUrl(normalizeUrl(url))
}

export function canonicalDriveUrl(raw: string): string {
  try {
    const url = new URL(normalizeUrl(raw))
    let path = url.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return url.protocol + '//' + url.host + path + url.search
  } catch {
    return normalizeUrl(raw)
  }
}

export function sameDriveUrl(left: string, right: string): boolean {
  return canonicalDriveUrl(left) === canonicalDriveUrl(right)
}

/** Side Chat Forks and subagents do not drive the 主会话 Browser. */
export function callerMayDrive(header: DriveCaller | undefined): boolean {
  if (header === undefined) return false
  if (header.parentSession !== undefined && header.parentSession.length > 0) return false
  if (header.origin === 'subagent') return false
  return true
}

export function listDriveTabs(input: {
  snapshot: SidebarSnapshot
  connected: ReadonlySet<string>
}): DriveTab[] {
  const out: DriveTab[] = []
  for (const tab of input.snapshot.tabs) {
    if (tab.kind !== 'Browser') continue
    const page = input.snapshot.browsers[tab.id]
    const url = page?.url || tab.target
    if (url.length === 0) continue
    const href = normalizeUrl(url)
    const frameUrl = page?.page?.frameUrl
    out.push({
      tabId: tab.id,
      url: href,
      title: tab.title,
      driveable: isDriveableUrl(href),
      connected: [...input.connected].some((live) => sameDriveUrl(live, href)),
      ...frameUrl === undefined ? {} : { frameUrl },
    })
  }
  return out
}

export function formatDriveTree(nodes: readonly DriveNode[], title: string): string {
  const lines = ['document "' + escapeDriveText(title) + '"']
  for (const node of nodes) {
    const name = escapeDriveText(node.name || node.selector)
    lines.push('  ' + node.role + ' "' + name + '" [ref=' + node.ref + ']')
  }
  return lines.join('\n')
}

export function driveAct(action: DriveAction): DriveResult {
  if (!isDriveableUrl(action.url)) {
    return fail('not-loopback', '只有本机 http 页面能给舵主操作，这个地址不行')
  }
  const guest = action.guest
  if (guest === undefined) {
    return fail('not-connected', '侧栏里的页面还没接上，先打开 Browser Tab 并等它加载完')
  }
  if (action.type === 'snapshot') {
    return { ok: true, snapshot: guest.snapshot() }
  }
  const acted = action.type === 'click'
    ? guest.click(action.ref)
    : guest.fill(action.ref, action.text)
  if (!acted.ok) return fail('unknown-ref', '找不到 ' + action.ref + '，先 browser_snapshot 再点')
  return { ok: true }
}

function fail(code: DriveErrorCode, message: string): DriveFailure {
  return { ok: false, code, message }
}

function escapeDriveText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
