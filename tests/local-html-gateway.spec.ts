import { request } from 'node:http'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalHtmlGateway } from '../src/local-html-gateway.ts'

const roots: string[] = []
const gateways: LocalHtmlGateway[] = []

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; outside: string; entry: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dcs-local-html-'))
  const outside = await mkdtemp(join(tmpdir(), 'dcs-local-html-outside-'))
  roots.push(root, outside)
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script>')
  await writeFile(join(root, 'assets', 'app.css'), 'body { color: rgb(1, 2, 3) }')
  await writeFile(join(root, 'assets', 'app.js'), 'globalThis.localHtmlLoaded = true')
  await writeFile(join(outside, 'secret.js'), 'globalThis.secret = true')
  return { root, outside, entry: pathToFileURL(join(root, 'index.html')).href }
}

function gateway(): LocalHtmlGateway {
  const value = new LocalHtmlGateway()
  gateways.push(value)
  return value
}

describe('LocalHtmlGateway', () => {
  it('serves one explicit HTML root over a private loopback capability and maps it back to file:', async () => {
    const box = await fixture()
    const target = box.entry + '?theme=dark#section'
    const local = gateway()
    const lease = await local.open('session:tab', target)
    const internal = new URL(lease.navigationUrl)

    expect(internal.hostname).toBe('127.0.0.1')
    expect(Number(internal.port)).toBeGreaterThan(0)
    expect(lease.publicUrl).toBe(target)
    expect(lease.publicUrl).not.toContain(internal.port)
    expect(lease.publicUrl).not.toContain(lease.token)
    expect(local.project('session:tab', lease.navigationUrl)).toBe(target)

    const page = await fetch(lease.navigationUrl)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await page.text()).toContain('assets/app.css')

    const style = await fetch(new URL('assets/app.css', lease.navigationUrl))
    expect(style.status).toBe(200)
    expect(style.headers.get('content-type')).toContain('text/css')
    expect(await style.text()).toContain('rgb(1, 2, 3)')
    expect(local.project('session:tab', new URL('assets/app.css', lease.navigationUrl).href)).toBe(pathToFileURL(join(box.root, 'assets', 'app.css')).href)
  })

  it('rejects invalid entries before starting a capability', async () => {
    const box = await fixture()
    const directory = join(box.root, 'folder.html')
    await mkdir(directory)
    const linked = join(box.root, 'linked.html')
    await symlink(join(box.root, 'index.html'), linked)
    const local = gateway()

    await expect(local.open('authority', 'file://server/share/index.html')).rejects.toThrow('local HTML')
    await expect(local.open('extension', pathToFileURL(join(box.root, 'assets', 'app.js')).href)).rejects.toThrow('local HTML')
    await expect(local.open('directory', pathToFileURL(directory).href)).rejects.toThrow('regular')
    await expect(local.open('symlink', pathToFileURL(linked).href)).rejects.toThrow('symbolic link')
    await expect(local.open('missing', pathToFileURL(join(box.root, 'missing.html')).href)).rejects.toThrow('local HTML')
    expect(local.resources()).toEqual({ listening: false, leases: 0 })
  })

  it('confines relative resources to the canonical parent and revokes them with the Tab', async () => {
    const box = await fixture()
    await symlink(join(box.outside, 'secret.js'), join(box.root, 'assets', 'escape.js'))
    const local = gateway()
    const lease = await local.open('session:tab', box.entry)
    const allowedPath = new URL('assets/app.js', lease.navigationUrl).pathname
    const prefix = allowedPath.slice(0, -'assets/app.js'.length)
    const origin = new URL(lease.navigationUrl).origin

    expect((await fetch(new URL('assets/escape.js', lease.navigationUrl))).status).toBe(404)
    expect((await rawRequest(origin, prefix + '../secret.js')).status).toBe(404)
    expect((await rawRequest(origin, prefix + '%2e%2e/secret.js')).status).toBe(404)
    expect((await rawRequest(origin, prefix + 'assets%2fapp.js')).status).toBe(404)
    expect((await rawRequest(origin, prefix + 'assets%5capp.js')).status).toBe(404)
    expect((await rawRequest(origin, prefix + 'assets/app.js', 'POST')).status).toBe(405)

    local.release('session:tab')
    expect(local.resources()).toMatchObject({ leases: 0 })
    expect((await fetch(lease.navigationUrl)).status).toBe(404)
    expect(local.project('session:tab', lease.navigationUrl)).toBeUndefined()
  })

  it('closes its loopback listener on dispose', async () => {
    const box = await fixture()
    const local = gateway()
    const lease = await local.open('session:tab', box.entry)
    expect(local.resources()).toEqual({ listening: true, leases: 1 })
    await local.dispose()
    gateways.splice(gateways.indexOf(local), 1)
    expect(local.resources()).toEqual({ listening: false, leases: 0 })
    await expect(fetch(lease.navigationUrl)).rejects.toThrow()
  })
})

function rawRequest(origin: string, path: string, method = 'GET'): Promise<{ status: number; body: string }> {
  const url = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = request({ hostname: url.hostname, port: url.port, path, method }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(Buffer.from(chunk)) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject)
    req.end()
  })
}
