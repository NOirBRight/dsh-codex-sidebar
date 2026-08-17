/** BrowserPort: fetch a page snapshot. Never starts the project. */

import { Worker } from 'node:worker_threads'
import type { BrowserPort, PageDocument, PageElement } from './browser.ts'

export function createHostBrowser(opts: {
  isBusy: () => boolean
  fetchHtml?: (url: string) => string | undefined
  openExternal?: (url: string) => void
}): BrowserPort {
  const fetchHtml = opts.fetchHtml ?? fetchHtmlOverHttp
  return {
    load(url) {
      const html = fetchHtml(url)
      if (html === undefined) return undefined
      return pageSnapshot(url, html)
    },
    openExternal(url) {
      opts.openExternal?.(url)
    },
    isBusy: () => opts.isBusy(),
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
  return { url, title: stripTags(title), elements }
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

function firstCapture(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html)
  const text = match?.[1]?.trim()
  return text === undefined || text.length === 0 ? undefined : text
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function fetchHtmlOverHttp(url: string): string | undefined {
  const max = 1024 * 1024
  const sab = new SharedArrayBuffer(8 + max)
  const header = new Int32Array(sab, 0, 2)
  let worker: Worker
  try {
    worker = new Worker(
      `
      const { workerData } = require('node:worker_threads')
      const { sab, url } = workerData
      const header = new Int32Array(sab, 0, 2)
      const bytes = new Uint8Array(sab, 8)
      fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5000) })
        .then(async (res) => {
          if (!res.ok) {
            Atomics.store(header, 0, 2)
            Atomics.notify(header, 0)
            return
          }
          const buf = Buffer.from(await res.text(), 'utf8')
          const n = Math.min(buf.length, bytes.length)
          bytes.set(buf.subarray(0, n))
          Atomics.store(header, 1, n)
          Atomics.store(header, 0, 1)
          Atomics.notify(header, 0)
        })
        .catch(() => {
          Atomics.store(header, 0, 2)
          Atomics.notify(header, 0)
        })
      `,
      { eval: true, workerData: { sab, url } },
    )
  } catch {
    return undefined
  }
  Atomics.wait(header, 0, 0, 6000)
  void worker.terminate()
  if (Atomics.load(header, 0) !== 1) return undefined
  const n = Atomics.load(header, 1)
  return Buffer.from(new Uint8Array(sab, 8, n)).toString('utf8')
}
