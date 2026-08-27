/** Private loopback projection for an explicitly selected local HTML directory. */

import { constants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { type AddressInfo } from 'node:net'
import { basename, dirname, extname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROUTE_PREFIX = '/.dcs-local-html/'
const LOCAL_HTML_ERROR = 'Only an absolute local HTML file can be opened'

type LeaseRecord = {
  token: string
  root: string
  publicRoot: string
  internalPrefix: string
}

export type LocalHtmlNavigation = {
  /** Address retained in session state and client projections. */
  publicUrl: string
  /** Private loopback address passed only to Host Chromium. */
  navigationUrl: string
}

/** Fixed-memory diagnostics that never include paths, ports, or capabilities. */
export type LocalHtmlResources = { listening: boolean; leases: number }

/**
 * Serves one canonical local directory per Browser Tab over a random loopback
 * capability. The public `file:` address never crosses into the HTTP route.
 */
export class LocalHtmlGateway {
  #server: Server | undefined
  #starting: Promise<string> | undefined
  #origin: string | undefined
  #disposed = false
  #byOwner = new Map<string, LeaseRecord>()
  #byToken = new Map<string, LeaseRecord>()

  /** Resolve an explicit local HTML entry to a private Chromium navigation. */
  async open(owner: string, rawUrl: string): Promise<LocalHtmlNavigation> {
    if (this.#disposed) throw new Error('Local HTML gateway is disposed')
    const entry = await localHtmlEntry(rawUrl)
    if (this.#disposed) throw new Error('Local HTML gateway is disposed')
    const origin = await this.#listen()
    if (this.#disposed) throw new Error('Local HTML gateway is disposed')
    let lease = this.#byOwner.get(owner)
    if (lease === undefined || lease.root !== entry.root) {
      if (lease !== undefined) this.#byToken.delete(lease.token)
      const token = randomBytes(24).toString('base64url')
      lease = {
        token,
        root: entry.root,
        publicRoot: entry.publicRoot,
        internalPrefix: ROUTE_PREFIX + token + '/',
      }
      this.#byOwner.set(owner, lease)
      this.#byToken.set(token, lease)
    } else {
      lease.publicRoot = entry.publicRoot
    }
    const navigation = new URL(lease.internalPrefix + encodeURIComponent(entry.name), origin)
    navigation.search = entry.url.search
    navigation.hash = entry.url.hash
    return { publicUrl: entry.url.href, navigationUrl: navigation.href }
  }

  /** Map a current private Page URL back to its public local file address. */
  project(owner: string, navigationUrl: string): string | undefined {
    const lease = this.#byOwner.get(owner)
    if (lease === undefined || this.#origin === undefined) return undefined
    let url: URL
    try { url = new URL(navigationUrl) } catch { return undefined }
    if (url.origin !== this.#origin || !url.pathname.startsWith(lease.internalPrefix)) return undefined
    const relative = decodeRelativePath(url.pathname.slice(lease.internalPrefix.length))
    if (relative === undefined) return undefined
    const publicPath = resolve(lease.publicRoot, ...relative)
    if (!within(lease.publicRoot, publicPath)) return undefined
    const projected = pathToFileURL(publicPath)
    projected.search = url.search
    projected.hash = url.hash
    return projected.href
  }

  /** Whether an address belongs to the private listener, including a revoked route. */
  isPrivate(navigationUrl: string): boolean {
    if (this.#origin === undefined) return false
    try { return new URL(navigationUrl).origin === this.#origin } catch { return false }
  }

  /** Remove private listener and capability identities from an error string. */
  redact(owner: string, message: string): string {
    const lease = this.#byOwner.get(owner)
    let redacted = this.#origin === undefined ? message : message.split(this.#origin).join('local-html://gateway')
    if (lease !== undefined) redacted = redacted.split(lease.token).join('<capability>')
    return redacted.replace(/local-html:\/\/gateway\/\.dcs-local-html\/[^/\s]+/g, 'local-html://gateway')
  }

  /** Revoke every local file route owned by one Browser Tab. */
  release(owner: string): void {
    const lease = this.#byOwner.get(owner)
    if (lease === undefined) return
    this.#byOwner.delete(owner)
    this.#byToken.delete(lease.token)
  }

  /** Return path-free lifecycle counters. */
  resources(): LocalHtmlResources {
    return { listening: this.#server !== undefined, leases: this.#byOwner.size }
  }

  /** Revoke all capabilities and close the private listener. */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#byOwner.clear()
    this.#byToken.clear()
    if (this.#starting !== undefined) await this.#starting.catch(() => undefined)
    const server = this.#server
    this.#server = undefined
    this.#origin = undefined
    if (server === undefined || !server.listening) return
    server.closeAllConnections()
    await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
  }

  async #listen(): Promise<string> {
    if (this.#disposed) throw new Error('Local HTML gateway is disposed')
    if (this.#origin !== undefined) return this.#origin
    if (this.#starting !== undefined) return this.#starting
    const server = createServer((req, res) => {
      void this.#respond(req, res).catch(() => { reply(res, 404) })
    })
    this.#server = server
    this.#starting = new Promise<string>((resolveStart, rejectStart) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        rejectStart(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address() as AddressInfo | null
        if (address === null || address.address !== '127.0.0.1') {
          server.close()
          rejectStart(new Error('Local HTML gateway did not bind loopback'))
          return
        }
        const origin = 'http://127.0.0.1:' + address.port
        this.#origin = origin
        resolveStart(origin)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
      server.unref()
    }).finally(() => { this.#starting = undefined })
    try {
      return await this.#starting
    } catch (error) {
      this.#server = undefined
      throw error
    }
  }

  async #respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD')
      reply(res, 405)
      return
    }
    const rawPath = (req.url ?? '').split(/[?#]/, 1)[0] ?? ''
    if (/%(?:2f|5c)/i.test(rawPath)) {
      reply(res, 404)
      return
    }
    let decoded: string
    try { decoded = decodeURIComponent(rawPath) } catch { reply(res, 404); return }
    if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith(ROUTE_PREFIX)) {
      reply(res, 404)
      return
    }
    const rest = decoded.slice(ROUTE_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 1) {
      reply(res, 404)
      return
    }
    const token = rest.slice(0, slash)
    const lease = this.#byToken.get(token)
    if (lease === undefined) {
      reply(res, 404)
      return
    }
    const relative = safeRelativePath(rest.slice(slash + 1))
    if (relative === undefined) {
      reply(res, 404)
      return
    }
    const requested = resolve(lease.root, ...relative)
    if (!within(lease.root, requested)) {
      reply(res, 404)
      return
    }
    let canonical: string
    try { canonical = await realpath(requested) } catch { reply(res, 404); return }
    if (!within(lease.root, canonical)) {
      reply(res, 404)
      return
    }
    let handle: FileHandle | undefined
    try {
      handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const stat = await handle.stat()
      if (!stat.isFile()) {
        await handle.close()
        reply(res, 404)
        return
      }
      res.writeHead(200, {
        'content-type': contentType(canonical),
        'content-length': stat.size,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      })
      if (req.method === 'HEAD') {
        await handle.close()
        res.end()
        return
      }
      const stream = handle.createReadStream({ autoClose: true })
      stream.on('error', () => { res.destroy() })
      res.on('close', () => { stream.destroy() })
      stream.pipe(res)
    } catch {
      await handle?.close().catch(() => undefined)
      reply(res, 404)
    }
  }
}

async function localHtmlEntry(rawUrl: string): Promise<{ url: URL; root: string; publicRoot: string; name: string }> {
  if (!/^file:\/\/\/(?!\/)/i.test(rawUrl.trim())) throw new Error(LOCAL_HTML_ERROR)
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error(LOCAL_HTML_ERROR) }
  if (url.protocol !== 'file:' || url.host.length > 0 || url.username.length > 0 || url.password.length > 0) throw new Error(LOCAL_HTML_ERROR)
  const pathUrl = new URL(url.href)
  pathUrl.search = ''
  pathUrl.hash = ''
  let path: string
  try { path = fileURLToPath(pathUrl) } catch { throw new Error(LOCAL_HTML_ERROR) }
  if (!isAbsolute(path) || !/^\.html?$/i.test(extname(path))) throw new Error(LOCAL_HTML_ERROR)
  let info
  try { info = await lstat(path) } catch { throw new Error(LOCAL_HTML_ERROR) }
  if (info.isSymbolicLink()) throw new Error('Local HTML entry must not be a symbolic link')
  if (!info.isFile()) throw new Error('Local HTML entry must be a regular file')
  const canonical = await realpath(path)
  if (!/^\.html?$/i.test(extname(canonical))) throw new Error(LOCAL_HTML_ERROR)
  return { url, root: dirname(canonical), publicRoot: dirname(path), name: basename(canonical) }
}

function decodeRelativePath(encoded: string): string[] | undefined {
  let decoded: string
  try { decoded = decodeURIComponent(encoded) } catch { return undefined }
  return safeRelativePath(decoded)
}

function safeRelativePath(decoded: string): string[] | undefined {
  if (decoded.length === 0 || decoded.includes('\0') || decoded.includes('\\')) return undefined
  const parts = decoded.split('/')
  return parts.some((part) => part.length === 0 || part === '.' || part === '..') ? undefined : parts
}

function within(root: string, path: string): boolean {
  return path !== root && path.startsWith(root + sep)
}

function reply(res: ServerResponse, status: number): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
  res.end()
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': case '.htm': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8'
    case '.json': case '.map': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.ico': return 'image/x-icon'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.ttf': return 'font/ttf'
    case '.otf': return 'font/otf'
    case '.wasm': return 'application/wasm'
    case '.pdf': return 'application/pdf'
    case '.txt': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}
