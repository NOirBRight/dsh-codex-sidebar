import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Page } from 'playwright-core'
import { ManagedBrowserStream } from '../src/managed-browser-stream.ts'
import { decodeBrowserStreamFrameV2, type BrowserLayout } from '../src/managed-browser-protocol.ts'
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

type StreamFrame = ReturnType<typeof decodeBrowserStreamFrameV2>

async function jpegCenterPixel(page: Page, frame: StreamFrame): Promise<number[]> {
  const base64 = Buffer.from(frame.jpeg).toString('base64')
  return page.evaluate(async (value) => {
    const image = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + value)).blob())
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('missing image context')
    context.drawImage(image, 0, 0)
    const pixel = Array.from(context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data)
    image.close()
    return pixel
  }, base64)
}

function jsonStreamFrame(data: WebSocket.RawData): StreamFrame | undefined {
  const text = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8')
    const message = JSON.parse(text) as { type?: unknown; version?: unknown; sequence?: unknown; sentAt?: unknown; revision?: unknown; mediaGeneration?: unknown; viewport?: unknown; encodedSize?: unknown; jpeg?: unknown }
  if (message.type !== 'frame' || typeof message.jpeg !== 'string') return undefined
  return {
    version: Number(message.version),
      sequence: Number(message.sequence),
      sentAt: Number(message.sentAt),
      revision: Number(message.revision),
      mediaGeneration: Number(message.mediaGeneration),
      viewport: message.viewport as StreamFrame['viewport'],
      encodedSize: message.encodedSize as StreamFrame['encodedSize'],
    jpeg: new Uint8Array(Buffer.from(message.jpeg, 'base64')),
  }
}

function nextStreamFrame(client: WebSocket, predicate: (frame: StreamFrame) => boolean = () => true, label = 'stream frame'): Promise<StreamFrame> {
  return new Promise((resolve, reject) => {
    const seen: string[] = []
    const timeout = setTimeout(() => { finish(new Error(label + ' timeout; saw ' + (seen.join(', ') || 'no frames'))) }, 15_000)
    const finish = (error: Error | null, frame?: StreamFrame): void => {
      clearTimeout(timeout)
      client.off('message', onMessage)
      client.off('error', onError)
      if (error !== null) reject(error)
      else if (frame !== undefined) resolve(frame)
    }
    const onError = (error: Error): void => { finish(error) }
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      try {
        const frame = isBinary
          ? decodeBrowserStreamFrameV2(data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : Array.isArray(data)
              ? Buffer.concat(data)
              : data)
          : jsonStreamFrame(data)
        if (frame !== undefined) {
          seen.push(`${frame.sequence}:${frame.revision}/${frame.mediaGeneration}:${frame.viewport.width}x${frame.viewport.height}`)
          if (predicate(frame)) finish(null, frame)
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    client.on('message', onMessage)
    client.once('error', onError)
  })
}

function nextLayoutCommit(client: WebSocket): Promise<BrowserLayout> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { finish(new Error('layout commit timeout')) }, 15_000)
    const finish = (error: Error | null, layout?: BrowserLayout): void => {
      clearTimeout(timeout)
      client.off('message', onMessage)
      client.off('error', onError)
      if (error !== null) reject(error)
      else if (layout !== undefined) resolve(layout)
    }
    const onError = (error: Error): void => { finish(error) }
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (isBinary) return
      try {
        const message = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as { type?: unknown; layout?: BrowserLayout }
        if (message.type === 'layout-commit' && message.layout !== undefined) finish(null, message.layout)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    client.on('message', onMessage)
    client.once('error', onError)
  })
}

describe('real managed Chromium', () => {
  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('loads local HTML assets without exposing or escaping its private root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-real-local-html-'))
    const pageRoot = join(root, 'page')
    const profileDir = join(root, 'profile')
    await mkdir(join(pageRoot, 'assets'), { recursive: true })
    await writeFile(join(root, 'outside.js'), 'globalThis.outsideExecuted = true')
    await writeFile(join(pageRoot, 'assets', 'app.css'), 'body { color: rgb(1, 2, 3) }')
    await writeFile(join(pageRoot, 'assets', 'app.js'), 'globalThis.localHtmlLoaded = true')
    await writeFile(join(pageRoot, 'index.html'), '<!doctype html><title>Local gateway</title><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script><script src="../outside.js"></script><h1>Local</h1>')
    const runtime = new ManagedBrowserRuntime({ profileDir, headless: true })
    cleanups.push(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }) })
    const tab = { sessionId: 'real-local', tabId: 'page' }
    const publicUrl = pathToFileURL(join(pageRoot, 'index.html')).href

    await expect(runtime.ensure(tab, publicUrl)).resolves.toMatchObject({ status: 'ready', title: 'Local gateway', url: publicUrl })
    const managedTarget = runtime.target(tab)
    if (managedTarget === undefined) throw new Error('missing local HTML Page')
    const target = managedTarget.page
    expect(target.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(runtime.projection(tab)?.url).toBe(publicUrl)
    expect(JSON.stringify(runtime.projection(tab))).not.toContain(new URL(target.url()).port)
    await expect(target.evaluate<{ loaded: boolean; outside: boolean; color: string }>(String.raw`(() => ({
      loaded: globalThis.localHtmlLoaded === true,
      outside: globalThis.outsideExecuted === true,
      color: getComputedStyle(document.body).color,
    }))()`)).resolves.toEqual({ loaded: true, outside: false, color: 'rgb(1, 2, 3)' })
    const committed = await runtime.proposeLayout(tab, { mode: 'laptop', viewport: { width: 1280, height: 800 } }, managedTarget.identity)
    await target.evaluate(String.raw`(() => {
      const root = window
      Object.defineProperty(root, 'Promise', { configurable: true, value: function SpoofedPromise() { throw new Error('spoofed Promise') } })
      Object.defineProperty(root, 'requestAnimationFrame', { configurable: true, value: () => { throw new Error('spoofed rAF') } })
      Object.defineProperty(root, 'devicePixelRatio', { configurable: true, value: 99 })
      Object.defineProperty(root, 'globalThis', { configurable: true, value: new Proxy({}, { get() { throw new Error('spoofed globalThis') } }) })
    })()`)
    await expect(runtime.verifyLayout(tab, committed, managedTarget.identity)).resolves.toEqual(committed)
  }, 30_000)

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
    await expect(runtime.capture(tab, { revision: 1, mediaGeneration: 1 })).resolves.toMatchObject({ mediaType: 'image/jpeg', width: 720, height: 860 })
  }, 30_000)

  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('streams local HTML at high density while preserving CSS viewport dimensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dcs-real-stream-'))
    const profileDir = join(root, 'profile')
    const pagePath = join(root, 'index.html')
    await writeFile(pagePath, '<!doctype html><title>Stream test</title><style>*{margin:0}.top,.bottom{height:900px}.top{background:#e11d48}.bottom{background:#2563eb}</style><section class="top"></section><section class="bottom"></section>')
    const streamServer = createServer()
    const runtime = new ManagedBrowserRuntime({ profileDir, headless: true })
    let now = 1_000
    const stream = new ManagedBrowserStream({ runtime, now: () => now })
    streamServer.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve, reject) => {
      streamServer.once('error', reject)
      streamServer.listen(0, '127.0.0.1', () => { resolve() })
    })
    const streamAddress = streamServer.address()
    if (streamAddress === null || typeof streamAddress === 'string') throw new Error('missing stream server port')

    const tab = { sessionId: 'stream-real', tabId: 'page' }
    const url = pathToFileURL(pagePath).href
    await expect(runtime.ensure(tab, url)).resolves.toMatchObject({ status: 'ready', title: 'Stream test' })
    const page = runtime.target(tab)?.page
    if (page === undefined) throw new Error('missing managed Page')
    const initialDeviceScaleFactor = await page.evaluate<number>('devicePixelRatio')
    let client: WebSocket | undefined
    cleanups.push(async () => {
      client?.close()
      await stream.dispose()
      await new Promise<void>((resolve) => { streamServer.close(() => { resolve() }) })
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
    })

    const ticket = stream.issue(tab)
    client = new WebSocket('ws://127.0.0.1:' + streamAddress.port + ticket.path, {
      headers: { origin: 'http://127.0.0.1:' + streamAddress.port },
    })
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => {
        client?.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
        resolve()
      })
      client?.once('error', reject)
    })
    const initialCommit = nextLayoutCommit(client)
    const initialFrame = nextStreamFrame(client, () => true, 'initial fit frame')
    client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 1, mode: 'fit', viewport: { width: 559, height: 621 } }))
    await expect(initialCommit).resolves.toMatchObject({ mode: 'fit', viewport: { width: 559, height: 621 } })
    const frame = await initialFrame
    const size = jpegSize(frame.jpeg)
    expect(frame.viewport).toEqual({ width: 559, height: 621 })
    expect(size).toEqual({ width: 839, height: 932 })
    const firstViewport = await page.evaluate<{ width: number; height: number; deviceScaleFactor: number }>('({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })')
    expect(firstViewport).toMatchObject({
      width: 559,
      height: 621,
    })
    expect(initialDeviceScaleFactor).toBeGreaterThan(0)
    expect(firstViewport.deviceScaleFactor).toBeGreaterThan(0)
    expect(await jpegCenterPixel(page as Page, frame)).toEqual(expect.arrayContaining([expect.closeTo(225, -1), expect.closeTo(29, -1), expect.closeTo(72, -1)]))

    now += 100
    const resizedCommit = nextLayoutCommit(client)
    const resizedFrame = nextStreamFrame(client, (candidate) => candidate.viewport.width === 390 && candidate.viewport.height === 844, 'resized frame')
    client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 2, mode: 'phone', viewport: { width: 390, height: 844 } }))
    await expect(resizedCommit).resolves.toMatchObject({ mode: 'phone', viewport: { width: 390, height: 844 } })
    expect(await page.evaluate('({ width: innerWidth, height: innerHeight, contentWidth: document.querySelector(".top")?.getBoundingClientRect().width, deviceScaleFactor: devicePixelRatio })')).toEqual({
      width: 390,
      height: 844,
      contentWidth: 390,
      deviceScaleFactor: firstViewport.deviceScaleFactor,
    })
    const resized = await resizedFrame
    expect(jpegSize(resized.jpeg)).toEqual({ width: 585, height: 1266 })
    client.send(JSON.stringify({ type: 'frame-ack', sequence: resized.sequence, revision: resized.revision, mediaGeneration: resized.mediaGeneration }))
    now += 300
    const scrolledFrame = nextStreamFrame(client, (candidate) => candidate.sequence > resized.sequence, 'scrolled frame')
    client.send(JSON.stringify({ type: 'input', revision: resized.revision, input: { type: 'wheel', x: 195, y: 422, deltaX: 0, deltaY: 900 } }))
    const scrolled = await scrolledFrame
    const pixel = await jpegCenterPixel(page as Page, scrolled)
    expect(pixel[2]).toBeGreaterThan(180)
    expect(pixel[0]).toBeLessThan(80)
    client.send(JSON.stringify({ type: 'frame-ack', sequence: scrolled.sequence, revision: scrolled.revision, mediaGeneration: scrolled.mediaGeneration }))

    now += 300
    const tabletCommit = nextLayoutCommit(client)
    const tabletFrame = nextStreamFrame(client, (candidate) => candidate.viewport.width === 768 && candidate.viewport.height === 1024, 'tablet frame')
    client.send(JSON.stringify({ type: 'layout-propose', proposalSequence: 3, mode: 'tablet', viewport: { width: 768, height: 1024 } }))
    await expect(tabletCommit).resolves.toMatchObject({ mode: 'tablet', viewport: { width: 768, height: 1024 } })
    const tablet = await tabletFrame
    expect(jpegSize(tablet.jpeg)).toEqual({ width: 1152, height: 1536 })
    expect(await page.evaluate('({ width: innerWidth, height: innerHeight })')).toEqual({ width: 768, height: 1024 })
    client.close()
  }, 30_000)

  it.skipIf(process.env.DSH_BROWSER_E2E !== '1')('keeps a committed laptop viewport when the first stream starts without a new proposal', async () => {
    const pageServer = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><title>Fixed stream test</title><style>*{margin:0}body{min-height:100vh;background:#e11d48}@media(min-width:1000px){body{background:#16a34a}}.top{height:100px;width:100%;background:#e11d48}</style><section class="top"></section>')
    })
    await new Promise<void>((resolve, reject) => {
      pageServer.once('error', reject)
      pageServer.listen(0, '127.0.0.1', () => { resolve() })
    })
    const pageAddress = pageServer.address()
    if (pageAddress === null || typeof pageAddress === 'string') throw new Error('missing page server port')

    const streamServer = createServer()
    const profileDir = await mkdtemp(join(tmpdir(), 'dcs-real-fixed-stream-'))
    const runtime = new ManagedBrowserRuntime({ profileDir, headless: true })
    const stream = new ManagedBrowserStream({ runtime })
    streamServer.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve, reject) => {
      streamServer.once('error', reject)
      streamServer.listen(0, '127.0.0.1', () => { resolve() })
    })
    const streamAddress = streamServer.address()
    if (streamAddress === null || typeof streamAddress === 'string') throw new Error('missing stream server port')

    const tab = { sessionId: 'fixed-stream-real', tabId: 'page' }
    const url = 'http://127.0.0.1:' + pageAddress.port + '/'
    await runtime.ensure(tab, url)
    await expect(runtime.proposeLayout(tab, { mode: 'laptop', viewport: { width: 1280, height: 800 } })).resolves.toMatchObject({
      revision: 2,
      mode: 'laptop',
      viewport: { width: 1280, height: 800 },
      mediaGeneration: 2,
    })
    const page = runtime.target(tab)?.page
    if (page === undefined) throw new Error('missing managed Page')
    await expect(page.evaluate('({ width: innerWidth, height: innerHeight })')).resolves.toEqual({ width: 1280, height: 800 })
    await page.setViewportSize({ width: 720, height: 773 })
    await expect(page.evaluate('({ width: innerWidth, height: innerHeight })')).resolves.toEqual({ width: 720, height: 773 })

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
    const committed = nextLayoutCommit(client)
    const firstFrame = nextStreamFrame(client, () => true, 'fixed laptop initial frame')
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => {
        client?.send(JSON.stringify({ type: 'hello', version: 2, frameEncodings: ['binary-v2', 'json-base64-v2'], flowControl: ['frame-ack-v2'], media: { webrtcVideo: false } }))
        resolve()
      })
      client?.once('error', reject)
    })

    await expect(committed).resolves.toMatchObject({ mode: 'laptop', viewport: { width: 1280, height: 800 } })
    const frame = await firstFrame
    expect(frame.viewport).toEqual({ width: 1280, height: 800 })
    expect(jpegSize(frame.jpeg)).toEqual({ width: 1920, height: 1200 })
    const pixel = await jpegCenterPixel(page as Page, frame)
    expect(pixel[1]).toBeGreaterThan(120)
    expect(pixel[0]).toBeLessThan(80)
    await expect(page.evaluate('({ width: innerWidth, height: innerHeight, contentWidth: document.querySelector(".top")?.getBoundingClientRect().width })')).resolves.toEqual({
      width: 1280,
      height: 800,
      contentWidth: 1280,
    })
  }, 30_000)
})
