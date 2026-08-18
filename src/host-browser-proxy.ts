/** Loopback-only reverse proxy that injects the Browser 批注 picker.
 *  HTTPS / third-party pages are not rewritten; those stay cross-origin and can only 圈选. */

import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import {
  DCS_PICK_SCRIPT_SRC,
  injectPickScript,
  isLoopbackHttpUrl,
  pickProxyPath,
  resolveProxyUpstream,
} from './browser-pick.ts'
import { DCS_PICK_SCRIPT } from './browser-pick-script.ts'

const STRIP = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'content-encoding',
  'content-length',
  'transfer-encoding',
])

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

export type LocalPickProxy = {
  ready: Promise<void>
  frameUrl(liveUrl: string): string | undefined
  close(): void
}

export function createLocalPickProxy(opts?: {
  bindHost?: string
  listen?: (server: http.Server, host: string) => Promise<number> | number
}): LocalPickProxy {
  const bindHost = opts?.bindHost ?? '127.0.0.1'
  const listen = opts?.listen ?? listenEphemeral
  const server = http.createServer((req, res) => {
    void handleHttp(req, res, bindHost, () => port)
  })
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head)
  })

  let port: number | undefined
  const bound = listen(server, bindHost)
  const ready = typeof bound === 'number'
    ? (port = bound, Promise.resolve())
    : bound.then((value) => {
      port = value
    })

  return {
    ready,
    frameUrl(liveUrl) {
      if (port === undefined || !isLoopbackHttpUrl(liveUrl)) return undefined
      const path = pickProxyPath(liveUrl)
      if (path === undefined) return undefined
      let hash = ''
      try {
        hash = new URL(liveUrl).hash
      } catch {
        hash = ''
      }
      return `http://${bindHost}:${port}${path}${hash}`
    },
    close() {
      server.close()
    },
  }
}

export function stripProxyResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || STRIP.has(key.toLowerCase())) continue
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

function listenEphemeral(server: http.Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, host, () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('pick proxy has no port'))
        return
      }
      resolve(addr.port)
    })
    server.once('error', reject)
  })
}

async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bindHost: string,
  portOf: () => number | undefined,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${bindHost}`)
    if (url.pathname === DCS_PICK_SCRIPT_SRC) {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(DCS_PICK_SCRIPT)
      return
    }
    const referer = headerValue(req.headers.referer)
    const cookie = headerValue(req.headers.cookie)
    const up = resolveProxyUpstream({
      pathname: url.pathname,
      ...referer === undefined ? {} : { referer },
      ...cookie === undefined ? {} : { cookie },
    })
    if (up === undefined) {
      res.writeHead(404).end()
      return
    }
    const upstream = new URL(`http://${hostForUrl(up.host)}:${up.port}${up.path}${url.search}`)
    const body = await readBody(req)
    const forwarded = await fetch(upstream, {
      method: req.method ?? 'GET',
      headers: outgoingHeaders(req, upstream),
      redirect: 'manual',
      ...body === undefined ? {} : { body: new Uint8Array(body) },
    })
    const headers = stripProxyResponseHeaders(Object.fromEntries(forwarded.headers.entries()))
    const location = forwarded.headers.get('location')
    if (location !== null) {
      headers.location = rewriteLocation(location, upstream, portOf())
    }
    const prefixed = parsePrefixed(url.pathname)
    if (prefixed !== undefined) {
      headers['set-cookie'] = `dcs_up=${prefixed.host}:${prefixed.port}; Path=/; SameSite=Lax`
    }
    const type = forwarded.headers.get('content-type') ?? ''
    if (type.includes('text/html')) {
      const html = injectPickScript(await forwarded.text())
      res.writeHead(forwarded.status, headers)
      res.end(html)
      return
    }
    const buf = Buffer.from(await forwarded.arrayBuffer())
    res.writeHead(forwarded.status, headers)
    res.end(buf)
  } catch {
    if (!res.headersSent) res.writeHead(502).end()
  }
}

function handleUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const referer = headerValue(req.headers.referer)
  const cookie = headerValue(req.headers.cookie)
  const up = resolveProxyUpstream({
    pathname: url.pathname,
    ...referer === undefined ? {} : { referer },
    ...cookie === undefined ? {} : { cookie },
  })
  if (up === undefined) {
    socket.destroy()
    return
  }
  const target = net.connect({ host: up.host, port: up.port }, () => {
    const lines = [`${req.method ?? 'GET'} ${up.path}${url.search} HTTP/1.1`]
    const headers = { ...req.headers, host: `${up.host}:${up.port}` }
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) lines.push(`${key}: ${item}`)
      } else {
        lines.push(`${key}: ${value}`)
      }
    }
    lines.push('', '')
    target.write(lines.join('\r\n'))
    if (head.length > 0) target.write(head)
    target.pipe(socket)
    socket.pipe(target)
  })
  target.on('error', () => { socket.destroy() })
  socket.on('error', () => { target.destroy() })
}

async function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  const method = req.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  return Buffer.concat(chunks)
}

function outgoingHeaders(req: http.IncomingMessage, upstream: URL): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    const name = key.toLowerCase()
    if (HOP.has(name) || value === undefined) continue
    if (name === 'cookie') {
      const cleaned = stripPickCookie(Array.isArray(value) ? value.join('; ') : value)
      if (cleaned.length > 0) headers.set('cookie', cleaned)
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  headers.set('host', `${upstream.hostname}:${upstream.port}`)
  return headers
}

function stripPickCookie(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('dcs_up='))
    .join('; ')
}

function rewriteLocation(location: string, upstream: URL, proxyPort: number | undefined): string {
  try {
    const abs = new URL(location, upstream)
    if (abs.origin !== upstream.origin) return location
    if (proxyPort === undefined) return location
    return `/__dcs/up/${encodeURIComponent(upstream.hostname)}/${upstream.port}${abs.pathname}${abs.search}${abs.hash}`
  } catch {
    return location
  }
}

function parsePrefixed(pathname: string): { host: string; port: number } | undefined {
  const found = resolveProxyUpstream({ pathname })
  if (found === undefined) return undefined
  if (!pathname.startsWith('/__dcs/up/')) return undefined
  return { host: found.host, port: found.port }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

function hostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}
