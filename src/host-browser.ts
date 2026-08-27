/** BrowserPort: synchronous chrome projection plus async managed-Page commands. */

import { managedBrowserHref, type BrowserPort, type PageDocument, type PageElement } from './browser.ts'
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts'

/** Optional HTML snapshot for tests. Production load never waits on the network. */
export type PageProbe =
  | { kind: 'html'; html: string }
  | { kind: 'unreachable' }

export function createHostBrowser(opts: {
  isBusy: () => boolean
  probe?: (url: string) => PageProbe
  openExternal?: (url: string) => void
  managed?: { runtime: ManagedBrowserRuntime; sessionId: string; closeStream?: (tabId: string) => void }
}): BrowserPort {
  return {
    load(url) {
      if (opts.probe !== undefined) return loadFromProbe(url, opts.probe(url))
      if (managedBrowserHref(url) === undefined) return undefined
      return liveSnapshot(url)
    },
    openExternal(url) {
      opts.openExternal?.(url)
    },
    isBusy: () => opts.isBusy(),
    ...opts.managed === undefined ? {} : {
      manage(tabId, url, action) {
        const tab = { sessionId: opts.managed?.sessionId ?? '', tabId }
        const command = action === 'back'
          ? opts.managed?.runtime.back(tab)
          : action === 'forward'
            ? opts.managed?.runtime.forward(tab)
            : action === 'refresh'
              ? opts.managed?.runtime.reload(tab)
              : opts.managed?.runtime.ensure(tab, url)
        void command?.catch(() => undefined)
      },
      resize(tabId, mode, width, height) {
        const command = opts.managed?.runtime.proposeLayout({ sessionId: opts.managed.sessionId, tabId }, { mode, viewport: { width, height } })
        void command?.catch(() => undefined)
      },
      close(tabId) {
        opts.managed?.closeStream?.(tabId)
        void opts.managed?.runtime.close({ sessionId: opts.managed.sessionId, tabId })
      },
    },
  }
}

function loadFromProbe(url: string, result: PageProbe): PageDocument | undefined {
  if (result.kind === 'html') return pageSnapshot(url, result.html)
  if (managedBrowserHref(url) === undefined) return undefined
  return liveSnapshot(url)
}

export function liveSnapshot(url: string): PageDocument {
  return {
    url,
    title: url,
    elements: [{ selector: 'body', text: url }],
  }
}

export function pageSnapshot(url: string, html: string): PageDocument {
  const title = firstCapture(html, /<title[^>]*>([^<]*)<\/title>/i) ?? url
  const elements: PageElement[] = []
  const seen = new Set<string>()
  collectTag(elements, seen, html, 'h1')
  collectTag(elements, seen, html, 'h2')
  collectTag(elements, seen, html, 'h3')
  collectTag(elements, seen, html, 'button')
  collectTag(elements, seen, html, 'a')
  collectIds(elements, seen, html)
  if (elements.length === 0) elements.push({ selector: 'body', text: stripTags(title) })
  return {
    url,
    title: stripTags(title),
    html: withBaseHref(url, html),
    elements,
  }
}

function collectTag(elements: PageElement[], seen: Set<string>, html: string, tag: string): void {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi')
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(html)) !== null) {
    index += 1
    const attrs = match[1] ?? ''
    const text = stripTags(match[2] ?? '')
    const id = attr(attrs, 'id')
    const cls = attr(attrs, 'class')
    const selector = id !== undefined
      ? `${tag}#${id}`
      : cls !== undefined
        ? `${tag}.${cls.split(/\s+/)[0]}`
        : `${tag}:nth-of-type(${index})`
    pushElement(elements, seen, selector, text.length === 0 ? selector : text)
  }
}

function collectIds(elements: PageElement[], seen: Set<string>, html: string): void {
  const pattern = /<([a-z0-9]+)\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1] ?? 'div'
    const id = match[2] ?? ''
    if (id.length === 0) continue
    pushElement(elements, seen, `${tag}#${id}`, id)
  }
}

function pushElement(elements: PageElement[], seen: Set<string>, selector: string, text: string): void {
  if (seen.has(selector)) return
  seen.add(selector)
  elements.push({ selector, text })
}

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(attrs)
  const value = match?.[1]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

function withBaseHref(url: string, html: string): string {
  const cap = 200_000
  const body = html.length > cap ? html.slice(0, cap) : html
  if (/<base\b/i.test(body)) return body
  const tag = `<base href="${url.replace(/"/g, '&quot;')}">`
  if (/<head[\s>]/i.test(body)) return body.replace(/<head([^>]*)>/i, `<head$1>${tag}`)
  return `${tag}${body}`
}

function firstCapture(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html)
  const text = match?.[1]?.trim()
  return text === undefined || text.length === 0 ? undefined : text
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
