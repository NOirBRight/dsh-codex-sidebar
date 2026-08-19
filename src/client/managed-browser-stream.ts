export const BROWSER_STREAM_HEADER_BYTES = 17

export type DecodedBrowserFrame = {
  version: number
  sequence: number
  sentAt: number
  width: number
  height: number
  jpeg: Uint8Array
}

export function decodeBrowserFrame(value: ArrayBuffer): DecodedBrowserFrame {
  if (value.byteLength < BROWSER_STREAM_HEADER_BYTES) throw new Error('Browser frame header is truncated')
  const view = new DataView(value)
  return {
    version: view.getUint8(0),
    sequence: view.getUint32(1),
    sentAt: view.getFloat64(5),
    width: view.getUint16(13),
    height: view.getUint16(15),
    jpeg: new Uint8Array(value, BROWSER_STREAM_HEADER_BYTES),
  }
}


export function browserStreamSignalsReady(value: unknown): boolean {
  if (value instanceof ArrayBuffer) return true
  if (typeof value !== 'string') return false
  try {
    const message = JSON.parse(value) as { type?: unknown; projection?: unknown }
    if (message.type === 'ready') return true
    if (message.type !== 'state' || typeof message.projection !== 'object' || message.projection === null) return false
    return (message.projection as { status?: unknown }).status === 'ready'
  } catch {
    return false
  }
}

export function browserWebSocketUrl(path: string, locationLike: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return (locationLike.protocol === 'https:' ? 'wss://' : 'ws://') + locationLike.host + path
}

export type StreamInput = { type: string; [key: string]: unknown }

export function createBrowserInputCoalescer(
  send: (input: StreamInput) => void,
  schedule: (flush: () => void) => number = (flush) => requestAnimationFrame(flush),
  cancelSchedule: (id: number) => void = (id) => cancelAnimationFrame(id),
): { push(input: StreamInput): void; flush(): void; cancel(): void } {
  let move: StreamInput | undefined
  let wheel: StreamInput | undefined
  let scheduled: number | undefined
  const flush = (): void => {
    scheduled = undefined
    if (move !== undefined) send(move)
    if (wheel !== undefined) send(wheel)
    move = undefined
    wheel = undefined
  }
  const arm = (): void => { scheduled ??= schedule(flush) }
  return {
    push(input) {
      if (input.type === 'move') {
        move = input
        arm()
        return
      }
      if (input.type === 'wheel') {
        wheel = wheel === undefined ? input : {
          ...input,
          deltaX: Number(wheel.deltaX ?? 0) + Number(input.deltaX ?? 0),
          deltaY: Number(wheel.deltaY ?? 0) + Number(input.deltaY ?? 0),
        }
        arm()
        return
      }
      flush()
      send(input)
    },
    flush,
    cancel() {
      if (scheduled !== undefined) cancelSchedule(scheduled)
      scheduled = undefined
      move = undefined
      wheel = undefined
    },
  }
}
