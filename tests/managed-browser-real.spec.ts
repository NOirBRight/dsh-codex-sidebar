import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { decodeBrowserStreamFrame, ManagedBrowserStream } from '../src/managed-browser-stream.ts'
import { ManagedBrowserRuntime } from '../src/managed-browser-runtime.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1] ?? 0
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { i += 2; continue }
    const length = (bytes[i + 2] ?? 0) * 256 + (bytes[i + 3] ?? 0)
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[i + 5] ?? 0) * 256 + (bytes[i + 6] ?? 0),
        width: (bytes[i + 7] ?? 0) * 256 + (bytes[i + 8] ?? 0),
      }
    }
    i += 2 + length
  }
  throw new Error('JPEG dimensions not found')
}

type StreamFrame = ReturnType<typeof decodeBrowserStreamFrame>

function nextStreamFrame(client: WebSocket, predicate: (frame: StreamFrame) => boolean = () => true): Promise<StreamFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { finish(new Error('stream frame timeout')) }, 15_000)
    const finish = (error: Error | null, frame?: StreamFrame): void => {
      clearTimeout(timeout)
      client.off('message', onMessage)
      client.off('error', onError)
      if (error !== null) reject(error)
      else if (frame !== undefined) resolve(frame)
    }
    const onError = (error: Error): void => { finish(error) }
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (!isBinary) return
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : Array.isArray(data)
          ? Buffer.concat(data)
          : data
      try {
        const frame = decodeBrowserStreamFrame(bytes)
        if (predicate(frame)) finish(null, frame)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    client.on('message', onMessage)
    client.once('error', onError)
  })
}

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

  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('streams a high-density frame while preserving CSS viewport dimensions', async () => {
    const pageServer = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><title>Stream test</title><style>body{font:24px sans-serif}</style><p>Streaming</p>')
    })
    await new Promise<void>((resolve, reject) => {
      pageServer.once('error', reject)
      pageServer.listen(0, '127.0.0.1', () => { resolve() })
    })
    const pageAddress = pageServer.address()
    if (pageAddress === null || typeof pageAddress === 'string') throw new Error('missing page server port')

    const streamServer = createServer()
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-real-stream-'))
    const runtime = new ManagedBrowserRuntime({ profileDir, headless: true })
    const stream = new ManagedBrowserStream({ runtime })
    streamServer.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve, reject) => {
      streamServer.once('error', reject)
      streamServer.listen(0, '127.0.0.1', () => { resolve() })
    })
    const streamAddress = streamServer.address()
    if (streamAddress === null || typeof streamAddress === 'string') throw new Error('missing stream server port')

    const tab = { sessionId: 'stream-real', tabId: 'page' }
    const url = 'http://127.0.0.1:' + pageAddress.port + '/'
    await expect(runtime.ensure(tab, url)).resolves.toMatchObject({ status: 'ready', title: 'Stream test' })
    let client: WebSocket | undefined
    cleanups.push(async () => {
      client?.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { streamServer.close(() => { resolve() }) })
      await runtime.dispose()
      await new Promise<void>((resolve) => { pageServer.close(() => { resolve() }) })
      await rm(profileDir, { recursive: true, force: true })
    })

    const ticket = stream.issue(tab)
    client = new WebSocket('ws://127.0.0.1:' + streamAddress.port + ticket.path, {
      headers: { origin: 'http://127.0.0.1:' + streamAddress.port },
    })
    const frame = await nextStreamFrame(client)
    const size = jpegSize(frame.jpeg)
    expect(frame.width).toBe(720)
    expect(frame.height).toBe(860)
    expect(size).toEqual({ width: 1080, height: 1290 })

    client.send(JSON.stringify({ type: 'resize', width: 390, height: 844 }))
    const resized = await nextStreamFrame(client, (candidate) => candidate.width === 390 && candidate.height === 844)
    expect(jpegSize(resized.jpeg)).toEqual({ width: 585, height: 1266 })
    client.close()
  }, 30_000)
})
