/** Click vs 圈选 for Browser 批注. Pure geometry — no DOM. */

export const PICK_DRAG_THRESHOLD = 5
export const PICK_POINT_BOX = 16

export type PickRect = {
  x: number
  y: number
  w: number
  h: number
}

export type PickOrigin = 'same' | 'cross'

export function isLassoGesture(dx: number, dy: number, threshold = PICK_DRAG_THRESHOLD): boolean {
  return Math.hypot(dx, dy) >= threshold
}

export function rectFromPoints(ax: number, ay: number, bx: number, by: number): PickRect {
  const x = Math.min(ax, bx)
  const y = Math.min(ay, by)
  return { x, y, w: Math.abs(bx - ax), h: Math.abs(by - ay) }
}

export function pointBox(x: number, y: number, size = PICK_POINT_BOX): PickRect {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size }
}

export function clampRect(rect: PickRect, width: number, height: number): PickRect {
  const maxX = Math.max(0, width)
  const maxY = Math.max(0, height)
  const x = Math.min(Math.max(0, rect.x), maxX)
  const y = Math.min(Math.max(0, rect.y), maxY)
  return {
    x,
    y,
    w: Math.min(Math.max(0, rect.w), maxX - x),
    h: Math.min(Math.max(0, rect.h), maxY - y),
  }
}

/** Map an iframe-viewport rect into overlay-local coordinates. */
export function mapIframeRect(
  rect: PickRect,
  iframeOrigin: { x: number; y: number },
  overlayOrigin: { x: number; y: number },
): PickRect {
  return {
    x: rect.x + iframeOrigin.x - overlayOrigin.x,
    y: rect.y + iframeOrigin.y - overlayOrigin.y,
    w: rect.w,
    h: rect.h,
  }
}

export function rectsIntersect(a: PickRect, b: PickRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function formatElementMark(tag: string, id: string, className: string, nthOfType: number): string {
  const name = tag.toLowerCase()
  if (id.length > 0) return `${name}#${id}`
  const cls = className.trim().split(/\s+/).find((token) => token.length > 0)
  if (cls !== undefined) return `${name}.${cls}`
  return `${name}:nth-of-type(${Math.max(1, nthOfType)})`
}

export function formatPointMark(url: string, x: number, y: number): string {
  return `${url} @ ${Math.round(x)},${Math.round(y)}`
}

export function formatLassoMark(url: string, rect: PickRect, selectors: readonly string[] = []): string {
  const box = `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)}`
  const names: string[] = []
  const seen = new Set<string>()
  for (const selector of selectors) {
    if (selector.length === 0 || seen.has(selector)) continue
    seen.add(selector)
    names.push(selector)
    if (names.length >= 4) break
  }
  if (names.length === 0) return `${url} @ ${box}`
  return `${names.join(', ')} @ ${box}`
}

export function formatPickMark(input: {
  mode: 'click' | 'lasso'
  origin: PickOrigin
  url: string
  x: number
  y: number
  rect?: PickRect
  selector?: string
  selectors?: readonly string[]
}): string {
  if (input.mode === 'click') {
    if (input.origin === 'same' && input.selector !== undefined && input.selector.length > 0) {
      return input.selector
    }
    return formatPointMark(input.url, input.x, input.y)
  }
  const rect = input.rect ?? pointBox(input.x, input.y)
  return formatLassoMark(input.url, rect, input.selectors ?? [])
}

export const DCS_PICK_TYPE = 'dcs-pick'
export const DCS_PICK_HIT = 'dcs-pick-hit'
export const DCS_PICK_SCAN = 'dcs-pick-scan'
export const DCS_PICK_SCAN_HIT = 'dcs-pick-scan-hit'
export const DCS_NAV = 'dcs-nav'
export const DCS_PICK_SCRIPT_SRC = '/__dcs/pick.js'
export const DCS_DRIVE_WAIT = '/__dcs/drive/wait'
export const DCS_DRIVE_REPLY = '/__dcs/drive/reply'

const PILL_H = 18

export type PickHitInfo = {
  tag: string
  name: string
  text: string
  selector: string
  label: string
}

export function formatPickLabel(name: string, tag: string): string {
  const t = tag.trim().toLowerCase()
  const n = name.trim()
  if (t.length === 0) return n.length === 0 ? 'node' : n
  if (n.length === 0 || n.toLowerCase() === t) return t
  return `${n} · ${t}`
}

export function pickElementName(input: {
  tag: string
  reactName?: string
  name?: string
  dataAttrs?: Readonly<Record<string, string>>
  id?: string
  className?: string
}): string {
  const react = input.reactName?.trim()
  if (react !== undefined && react.length > 0) return react
  const attrName = input.name?.trim()
  if (attrName !== undefined && attrName.length > 0) return attrName
  const data = preferredDataName(input.dataAttrs ?? {})
  if (data.length > 0) return data
  const id = input.id?.trim()
  if (id !== undefined && id.length > 0) return id
  const cls = input.className?.trim().split(/\s+/).find((token) => token.length > 0)
  return cls ?? ''
}

export function formatPickContext(hit: {
  label: string
  selector?: string
  text?: string
}): string {
  const lines: string[] = []
  const seen = new Set<string>()
  addContextLine(lines, seen, hit.label)
  if (hit.selector !== undefined) addContextLine(lines, seen, hit.selector)
  if (hit.text !== undefined) addContextLine(lines, seen, compactText(hit.text, 100))
  return lines.join('\n')
}

export function shortPickCaption(mark: string, hint?: string): string {
  const fromHint = hint?.trim()
  if (fromHint !== undefined && fromHint.length > 0) return clipCaption(fromHint)
  const beforeAt = mark.split(' @ ')[0]?.trim() ?? ''
  const first = beforeAt.split(',')[0]?.trim() ?? ''
  if (first.length === 0) return '元素'
  return clipCaption(first)
}

function clipCaption(text: string, max = 22): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}

export function placePill(
  rect: PickRect,
  overlay: { w: number; h: number },
  pillH = PILL_H,
): { x: number; y: number; flip: boolean } {
  const maxX = Math.max(0, overlay.w)
  const x = Math.min(Math.max(0, rect.x), maxX)
  const above = rect.y - pillH
  if (above >= 0) return { x, y: above, flip: false }
  const below = rect.y + rect.h
  if (below + pillH <= overlay.h) return { x, y: below, flip: true }
  return { x, y: Math.max(0, rect.y), flip: true }
}

export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost')
}

export function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)
  } catch {
    return false
  }
}

export function pickProxyPath(liveUrl: string): string | undefined {
  if (!isLoopbackHttpUrl(liveUrl)) return undefined
  const parsed = new URL(liveUrl)
  const port = parsed.port.length > 0 ? parsed.port : '80'
  return `/__dcs/up/${encodeURIComponent(parsed.hostname)}/${port}${parsed.pathname}${parsed.search}`
}

export function parsePickProxyPath(pathname: string): { host: string; port: number; path: string } | undefined {
  const match = /^\/__dcs\/up\/([^/]+)\/(\d{1,5})(\/.*)?$/.exec(pathname)
  if (match === null) return undefined
  let host = match[1] ?? ''
  try {
    host = decodeURIComponent(host)
  } catch {
    return undefined
  }
  const port = Number(match[2])
  if (!isLoopbackHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
  const rest = match[3]
  return { host, port, path: rest === undefined || rest.length === 0 ? '/' : rest }
}

/** Map a loopback pick-proxy iframe src back to the live http URL. */
export function liveUrlFromFrameSrc(frameSrc: string): string | undefined {
  try {
    const url = frameSrc.startsWith('/') ? new URL(frameSrc, 'http://127.0.0.1') : new URL(frameSrc)
    const parsed = parsePickProxyPath(url.pathname)
    if (parsed === undefined) {
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
    }
    const port = parsed.port === 80 ? '' : `:${parsed.port}`
    return `http://${parsed.host}${port}${parsed.path}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

export function resolveProxyUpstream(input: {
  pathname: string
  referer?: string
  cookie?: string
}): { host: string; port: number; path: string } | undefined {
  if (input.pathname === DCS_PICK_SCRIPT_SRC || (input.pathname.startsWith('/__dcs/') && parsePickProxyPath(input.pathname) === undefined)) {
    return undefined
  }
  const direct = parsePickProxyPath(input.pathname)
  if (direct !== undefined) return direct
  const fromRef = upstreamFromReferer(input.referer)
  const fromCookie = upstreamFromCookie(input.cookie)
  const up = fromRef ?? fromCookie
  if (up === undefined) return undefined
  return { host: up.host, port: up.port, path: input.pathname.length === 0 ? '/' : input.pathname }
}

export function injectPickScript(html: string, scriptSrc = DCS_PICK_SCRIPT_SRC): string {
  if (html.includes('data-dcs-pick')) return html
  const stripped = stripMetaCsp(html)
  const tag = '<script data-dcs-pick src="' + scriptSrc + '"></script>'
  if (/<head[\s>]/i.test(stripped)) return stripped.replace(/<head([^>]*)>/i, '<head$1>' + tag)
  if (/<html[\s>]/i.test(stripped)) return stripped.replace(/<html([^>]*)>/i, '<html$1>' + tag)
  return tag + stripped
}

function stripMetaCsp(html: string): string {
  return html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi, '')
}

function preferredDataName(attrs: Readonly<Record<string, string>>): string {
  const order = ['data-component', 'data-name', 'data-testid', 'data-id']
  for (const key of order) {
    const value = attrs[key]?.trim()
    if (value !== undefined && value.length > 0) return value
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith('data-') || key === 'data-dcs-pick') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}

function addContextLine(lines: string[], seen: Set<string>, line: string): void {
  const trimmed = line.trim()
  if (trimmed.length === 0 || seen.has(trimmed)) return
  seen.add(trimmed)
  lines.push(trimmed)
}

function compactText(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function upstreamFromReferer(referer: string | undefined): { host: string; port: number } | undefined {
  if (referer === undefined || referer.length === 0) return undefined
  try {
    const parsed = new URL(referer)
    const found = parsePickProxyPath(parsed.pathname)
    if (found === undefined) return undefined
    return { host: found.host, port: found.port }
  } catch {
    return undefined
  }
}

function upstreamFromCookie(cookie: string | undefined): { host: string; port: number } | undefined {
  if (cookie === undefined || cookie.length === 0) return undefined
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    if (!trimmed.startsWith('dcs_up=')) continue
    const value = trimmed.slice('dcs_up='.length)
    const split = value.lastIndexOf(':')
    if (split <= 0) continue
    const host = value.slice(0, split)
    const port = Number(value.slice(split + 1))
    if (!isLoopbackHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue
    return { host, port }
  }
  return undefined
}
