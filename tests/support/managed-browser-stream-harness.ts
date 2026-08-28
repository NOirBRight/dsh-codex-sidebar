import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import type { ManagedTabKey } from '../../src/managed-browser-runtime.ts'
import type { ManagedBrowserStream } from '../../src/managed-browser-stream.ts'

type StreamUnderTest = Pick<ManagedBrowserStream, 'dispose' | 'handleUpgrade' | 'issue'>

export type BrowserStreamHelloOptions = {
  frameEncodings?: Array<'binary-v2' | 'json-base64-v2'>
  webrtcVideo?: boolean
}

export type BrowserStreamConnectOptions = {
  origin?: string
  path?: string
}

/** Real loopback WebSocket transport shared by managed Browser stream tests. */
export class ManagedBrowserStreamHarness {
  readonly origin: string
  #stream: StreamUnderTest
  #server: Server
  #clients = new Set<WebSocket>()
  #disposing: Promise<void> | undefined

  private constructor(stream: StreamUnderTest, server: Server, origin: string) {
    this.#stream = stream
    this.#server = server
    this.origin = origin
  }

  /** Start one real loopback HTTP upgrade server for a stream under test. */
  static async start(stream: StreamUnderTest): Promise<ManagedBrowserStreamHarness> {
    const server = createServer()
    server.on('upgrade', (request, socket, head) => { stream.handleUpgrade(request, socket, head) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      throw new Error('missing stream port')
    }
    return new ManagedBrowserStreamHarness(stream, server, `http://127.0.0.1:${address.port}`)
  }

  /** Open one real WebSocket, optionally using a pre-issued ticket path or desktop Origin. */
  async connect(tab: ManagedTabKey, options: BrowserStreamConnectOptions = {}): Promise<WebSocket> {
    const path = options.path ?? this.#stream.issue(tab).path
    const url = this.origin.replace(/^http:/, 'ws:') + path
    const client = options.origin === undefined
      ? new WebSocket(url)
      : new WebSocket(url, { headers: { origin: options.origin } })
    this.#clients.add(client)
    client.once('close', () => { this.#clients.delete(client) })
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', () => { resolve() })
        client.once('error', reject)
      })
    } catch (error) {
      await this.dispose()
      throw error
    }
    return client
  }

  /** Send the valid protocol-v2 hello used by stream integration tests. */
  hello(client: WebSocket, options: BrowserStreamHelloOptions = {}): void {
    client.send(JSON.stringify({
      type: 'hello',
      version: 2,
      frameEncodings: options.frameEncodings ?? ['json-base64-v2'],
      flowControl: ['frame-ack-v2'],
      media: { webrtcVideo: options.webrtcVideo ?? false },
    }))
  }

  /** Close every tracked client, dispose the stream, and stop the loopback server. */
  dispose(): Promise<void> {
    if (this.#disposing !== undefined) return this.#disposing
    this.#disposing = this.#dispose()
    return this.#disposing
  }

  async #dispose(): Promise<void> {
    for (const client of this.#clients) client.close()
    try {
      await this.#stream.dispose()
    } finally {
      if (this.#server.listening) {
        await new Promise<void>((resolve) => { this.#server.close(() => { resolve() }) })
      }
    }
  }
}
