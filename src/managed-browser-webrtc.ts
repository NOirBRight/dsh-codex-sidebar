/** Chromium-owned Canvas/WebRTC encoder isolated from the Browser control protocol. */

export type BrowserMediaIdentity = {
  readonly ownerId: string
  readonly generation: number
}

export type BrowserRtcDescription = {
  type: 'offer' | 'answer'
  sdp: string
}

export type BrowserRtcCandidate = {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type BrowserMediaFrame = {
  sequence: number
  width: number
  height: number
  jpeg: Uint8Array
}

export type BrowserPeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

export type BrowserMediaPageSignal =
  | { type: 'candidate'; candidate: BrowserRtcCandidate | null }
  | { type: 'connection-state'; state: BrowserPeerConnectionState }

export type BrowserMediaSignal = BrowserMediaIdentity & {
  signal:
    | BrowserMediaPageSignal
    | { type: 'frame-painted'; sequence: number; width: number; height: number }
    | { type: 'encoder-error'; message: string }
}

/** The only owned-Page operations required by the media encoder. Binding sources identify this adapter as `source.page`. */
export type BrowserMediaPage = {
  exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void>
  evaluateFunction<R>(source: string, argument: unknown): Promise<R>
  close(): Promise<void>
}

export type ManagedBrowserWebRtcEncoderOptions = {
  identity: BrowserMediaIdentity
  pageFactory: () => Promise<BrowserMediaPage>
  stunUrls?: readonly string[]
  width: number
  height: number
  onSignal?: (signal: BrowserMediaSignal) => void
}

const SIGNAL_BINDING = '__dcsManagedMediaSignal'

const BOOTSTRAP = String.raw`async (config) => {
  const signal = (payload) => globalThis.__dcsManagedMediaSignal(payload);
  document.documentElement.innerHTML = '<head><meta charset="utf-8"></head><body><canvas></canvas></body>';
  const canvas = document.querySelector('canvas');
  canvas.width = config.width;
  canvas.height = config.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('Managed Browser media Canvas is unavailable');
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  if (track === undefined) throw new Error('Managed Browser media track is unavailable');
  const peer = new RTCPeerConnection({ iceServers: config.iceServers });
  peer.addTrack(track, stream);
  peer.onicecandidate = (event) => {
    void signal({ type: 'candidate', candidate: event.candidate === null ? null : event.candidate.toJSON() });
  };
  peer.onconnectionstatechange = () => {
    void signal({ type: 'connection-state', state: peer.connectionState });
  };
  let disposed = false;
  const command = async (value) => {
    if (value.type === 'dispose') {
      if (disposed) return;
      disposed = true;
      track.stop();
      peer.close();
      return;
    }
    if (disposed) throw new Error('Managed Browser media encoder is disposed');
    if (value.type === 'create-offer') {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      return peer.localDescription?.toJSON();
    }
    if (value.type === 'accept-answer') {
      await peer.setRemoteDescription(value.description);
      return;
    }
    if (value.type === 'add-candidate') {
      await peer.addIceCandidate(value.candidate);
      return;
    }
    if (value.type === 'paint') {
      const binary = atob(value.jpegBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      try {
        if (canvas.width !== value.width) canvas.width = value.width;
        if (canvas.height !== value.height) canvas.height = value.height;
        context.drawImage(image, 0, 0, value.width, value.height);
        track.requestFrame();
      } finally {
        image.close();
      }
      return;
    }
    throw new Error('Unknown Managed Browser media command');
  };
  globalThis.__dcsManagedMediaEncoder = { command };
}`

const COMMAND = String.raw`async (value) => {
  const encoder = globalThis.__dcsManagedMediaEncoder;
  if (encoder === undefined) throw new Error('Managed Browser media encoder is not initialized');
  return encoder.command(value);
}`

/** Validate and copy STUN-only ICE server URLs. */
export function validateBrowserStunUrls(urls: readonly string[]): string[] {
  return urls.map((value) => {
    if (/\s/.test(value) || !value.startsWith('stun:') || value.startsWith('stun://')) throw new Error('Managed Browser WebRTC accepts STUN URLs only')
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('Managed Browser WebRTC accepts valid STUN URLs only')
    }
    if (parsed.protocol !== 'stun:' || parsed.pathname.length === 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
      throw new Error('Managed Browser WebRTC accepts valid STUN URLs only')
    }
    return value
  })
}

/** One immutable Browser owner/generation and its Chromium media Page. */
export class ManagedBrowserWebRtcEncoder {
  readonly identity: BrowserMediaIdentity
  #pageFactory: () => Promise<BrowserMediaPage>
  #stunUrls: string[]
  #width: number
  #height: number
  #onSignal: (signal: BrowserMediaSignal) => void
  #page: BrowserMediaPage | undefined
  #startPromise: Promise<BrowserRtcDescription> | undefined
  #disposePromise: Promise<void> | undefined
  #disposed = false
  #connected = false
  #dirty: Omit<BrowserMediaFrame, 'jpeg'> & { jpegBase64: string } | undefined
  #paintPromise: Promise<void> | undefined

  constructor(opts: ManagedBrowserWebRtcEncoderOptions) {
    this.identity = Object.freeze({ ...opts.identity })
    this.#pageFactory = opts.pageFactory
    this.#stunUrls = validateBrowserStunUrls(opts.stunUrls ?? [])
    this.#width = positiveDimension(opts.width, 'width')
    this.#height = positiveDimension(opts.height, 'height')
    this.#onSignal = opts.onSignal ?? (() => {})
  }

  /** Create the owned Page and return its SDP offer. */
  start(): Promise<BrowserRtcDescription> {
    if (this.#disposed) return Promise.reject(new Error('Managed Browser WebRTC encoder is disposed'))
    this.#startPromise ??= this.#start()
    return this.#startPromise
  }

  /** Apply the authenticated client's SDP answer. */
  async acceptAnswer(description: BrowserRtcDescription): Promise<void> {
    if (description.type !== 'answer') throw new Error('Managed Browser WebRTC expected an SDP answer')
    await this.#command({ type: 'accept-answer', description })
  }

  /** Add one authenticated client ICE candidate, including the end-of-candidates marker. */
  async addCandidate(candidate: BrowserRtcCandidate | null): Promise<void> {
    await this.#command({ type: 'add-candidate', candidate })
  }

  /** Retain the latest JPEG until the peer can accept one serialized Canvas paint. */
  submit(frame: BrowserMediaFrame): boolean {
    if (this.#disposed) return false
    this.#dirty = {
      sequence: positiveInteger(frame.sequence, 'sequence'),
      width: positiveDimension(frame.width, 'width'),
      height: positiveDimension(frame.height, 'height'),
      jpegBase64: Buffer.from(frame.jpeg).toString('base64'),
    }
    this.#pump()
    return true
  }

  /** Stop the track and peer, close the owned Page, and ignore later callbacks. */
  dispose(): Promise<void> {
    this.#disposePromise ??= this.#dispose()
    return this.#disposePromise
  }

  async #start(): Promise<BrowserRtcDescription> {
    const page = await this.#pageFactory()
    this.#page = page
    if (this.#disposed) {
      this.#page = undefined
      await page.close().catch(() => undefined)
      throw new Error('Managed Browser WebRTC encoder is disposed')
    }
    try {
      await page.exposeBinding(SIGNAL_BINDING, (source, payload) => {
        if (this.#disposed || this.#page !== page || sourcePage(source) !== page) return
        const signal = browserMediaPageSignal(payload)
        if (signal === undefined) return
        this.#emit(signal)
        if (signal.type === 'connection-state') {
          this.#connected = signal.state === 'connected'
          this.#pump()
        }
      })
      await page.evaluateFunction(BOOTSTRAP, {
        iceServers: this.#stunUrls.length === 0 ? [] : [{ urls: this.#stunUrls }],
        width: this.#width,
        height: this.#height,
      })
      const offer = await page.evaluateFunction<unknown>(COMMAND, { type: 'create-offer' })
      if (!browserRtcDescription(offer, 'offer')) throw new Error('Managed Browser media Page returned an invalid SDP offer')
      return offer
    } catch (error) {
      if (this.#page === page) this.#page = undefined
      await page.close().catch(() => undefined)
      throw error
    }
  }

  async #command(command: Record<string, unknown>): Promise<void> {
    const page = await this.#readyPage()
    await page.evaluateFunction(COMMAND, command)
  }

  async #readyPage(): Promise<BrowserMediaPage> {
    if (this.#disposed) throw new Error('Managed Browser WebRTC encoder is disposed')
    await this.start()
    const page = this.#page
    if (page === undefined || this.#disposed) throw new Error('Managed Browser WebRTC encoder is disposed')
    return page
  }

  #pump(): void {
    if (this.#disposed || !this.#connected || this.#paintPromise !== undefined || this.#dirty === undefined || this.#page === undefined) return
    const frame = this.#dirty
    const page = this.#page
    this.#dirty = undefined
    this.#paintPromise = page.evaluateFunction(COMMAND, { type: 'paint', ...frame }).then(() => {
      if (this.#disposed || this.#page !== page) return
      this.#emit({ type: 'frame-painted', sequence: frame.sequence, width: frame.width, height: frame.height })
    }).catch((error: unknown) => {
      if (!this.#disposed && this.#page === page) this.#emit({ type: 'encoder-error', message: errorMessage(error) })
    }).finally(() => {
      this.#paintPromise = undefined
      this.#pump()
    })
  }

  #emit(signal: BrowserMediaSignal['signal']): void {
    this.#onSignal({ ...this.identity, signal })
  }

  async #dispose(): Promise<void> {
    this.#disposed = true
    this.#connected = false
    this.#dirty = undefined
    if (this.#startPromise !== undefined) await this.#startPromise.catch(() => undefined)
    const page = this.#page
    this.#page = undefined
    if (page === undefined) return
    await page.evaluateFunction(COMMAND, { type: 'dispose' }).catch(() => undefined)
    await page.close().catch(() => undefined)
  }
}

function browserMediaPageSignal(value: unknown): BrowserMediaPageSignal | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const signal = value as { type?: unknown; state?: unknown; candidate?: unknown }
  if (signal.type === 'connection-state' && connectionState(signal.state)) return { type: 'connection-state', state: signal.state }
  if (signal.type !== 'candidate') return undefined
  if (signal.candidate === null) return { type: 'candidate', candidate: null }
  if (!browserRtcCandidate(signal.candidate)) return undefined
  return { type: 'candidate', candidate: signal.candidate }
}

function browserRtcDescription(value: unknown, expected: 'offer' | 'answer'): value is BrowserRtcDescription {
  if (typeof value !== 'object' || value === null) return false
  const description = value as { type?: unknown; sdp?: unknown }
  return description.type === expected && typeof description.sdp === 'string'
}

function browserRtcCandidate(value: unknown): value is BrowserRtcCandidate {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown; usernameFragment?: unknown }
  return typeof candidate.candidate === 'string'
    && (candidate.sdpMid === undefined || candidate.sdpMid === null || typeof candidate.sdpMid === 'string')
    && (candidate.sdpMLineIndex === undefined || candidate.sdpMLineIndex === null || typeof candidate.sdpMLineIndex === 'number')
    && (candidate.usernameFragment === undefined || candidate.usernameFragment === null || typeof candidate.usernameFragment === 'string')
}

function connectionState(value: unknown): value is BrowserPeerConnectionState {
  return value === 'new' || value === 'connecting' || value === 'connected' || value === 'disconnected' || value === 'failed' || value === 'closed'
}

function sourcePage(source: unknown): unknown {
  return typeof source === 'object' && source !== null ? (source as { page?: unknown }).page : undefined
}

function positiveDimension(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 8192) throw new Error('Managed Browser media ' + name + ' must be an integer from 1 to 8192')
  return value
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Managed Browser media ' + name + ' must be a positive integer')
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
