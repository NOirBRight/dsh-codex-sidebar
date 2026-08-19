import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('real managed Chromium', () => {
  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('opens, drives, and captures a real Page', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><title>Managed test</title><input name="email" placeholder="Email"><button id="save" onclick="this.textContent=\'Saved\'">Save</button>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing test server port')
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-real-browser-'))
    const runtime = new ManagedBrowserRuntime({ profileDir, headless: true })
    cleanups.push(async () => { await runtime.dispose(); await rm(profileDir, { recursive: true, force: true }) })
    const tab = { sessionId: 'real', tabId: 'page' }
    const url = 'http://127.0.0.1:' + address.port + '/'

    await expect(runtime.ensure(tab, url)).resolves.toMatchObject({ status: 'ready', title: 'Managed test' })
    const snapshot = await runtime.snapshot(tab)
    if (!('nodes' in snapshot)) throw new Error(snapshot.ok ? 'missing nodes' : snapshot.message)
    const input = snapshot.nodes.find((node) => node.selector.includes('email'))
    const button = snapshot.nodes.find((node) => node.selector === '#save')
    expect(input?.ref).toMatch(/^@d\d+e\d+$/)
    expect(button?.ref).toMatch(/^@d\d+e\d+$/)
    if (input === undefined || button === undefined) throw new Error('missing test controls')
    await expect(runtime.fill(tab, input.ref, 'ada@example.com')).resolves.toEqual({ ok: true })
    await expect(runtime.click(tab, button.ref)).resolves.toEqual({ ok: true })
    await expect(runtime.capture(tab)).resolves.toMatchObject({ mediaType: 'image/jpeg', width: 720, height: 860 })
  }, 30_000)
})
