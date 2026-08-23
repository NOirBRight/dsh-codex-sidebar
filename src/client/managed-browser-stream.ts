export function browserStreamShouldRun(pageVisible: boolean, intersecting: boolean): boolean {
  return pageVisible && intersecting
}

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




export type BrowserOutlineNode = {
  ref: string
  role: string
  name: string
  selector: string
  rect: { x: number; y: number; w: number; h: number }
}

export type BrowserOutline = {
  documentId: string
  nodes: BrowserOutlineNode[]
}

export function decodeBrowserOutline(value: string): BrowserOutline | undefined {
  try {
    const message = JSON.parse(value) as { type?: unknown; documentId?: unknown; nodes?: unknown }
    if (message.type !== 'outline' || typeof message.documentId !== 'string' || !Array.isArray(message.nodes)) return undefined
    const nodes: BrowserOutlineNode[] = []
    for (const value of message.nodes) {
      if (!browserOutlineNode(value)) return undefined
      nodes.push(value)
    }
    return { documentId: message.documentId, nodes }
  } catch {
    return undefined
  }
}



export type BrowserAnnotationRect = { x: number; y: number; w: number; h: number }





export type BrowserTrackedRect = {
  documentId: string
  selector: string
  rect: BrowserAnnotationRect | null
}

export function decodeBrowserTrackedRect(value: string): BrowserTrackedRect | undefined {
  try {
    const message = JSON.parse(value) as { type?: unknown; documentId?: unknown; selector?: unknown; rect?: unknown }
    if (message.type !== 'tracked-rect' || typeof message.documentId !== 'string' || typeof message.selector !== 'string') return undefined
    if (message.rect === null) return { documentId: message.documentId, selector: message.selector, rect: null }
    if (!browserAnnotationRect(message.rect)) return undefined
    return { documentId: message.documentId, selector: message.selector, rect: message.rect }
  } catch {
    return undefined
  }
}

export function updateBrowserSelectedRect(current: BrowserAnnotationRect | null, update: { type: 'wheel' } | { type: 'tracked'; rect: BrowserAnnotationRect | null }): BrowserAnnotationRect | null {
  return update.type === 'tracked' ? update.rect : current
}

export function browserAnnotationHighlightRects(selected: BrowserAnnotationRect | null, hovered: BrowserAnnotationRect | null): { selected: BrowserAnnotationRect | null; hovered: BrowserAnnotationRect | null } {
  return { selected, hovered: sameBrowserAnnotationRect(selected, hovered) ? null : hovered }
}

function sameBrowserAnnotationRect(left: BrowserAnnotationRect | null, right: BrowserAnnotationRect | null): boolean {
  return left !== null && right !== null && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h
}

function browserAnnotationRect(value: unknown): value is BrowserAnnotationRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  return [rect.x, rect.y, rect.w, rect.h].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
}

export function browserSelectedRectForOutline(selector: string, nodes: readonly BrowserOutlineNode[]): BrowserAnnotationRect | null {
  return nodes.find((node) => node.selector === selector)?.rect ?? null
}

export function browserAnnotationNodeAt(nodes: readonly BrowserOutlineNode[], point: { x: number; y: number }): BrowserOutlineNode | undefined {
  return nodes
    .filter((node) => node.rect.w > 0 && node.rect.h > 0
      && point.x >= node.rect.x && point.x <= node.rect.x + node.rect.w
      && point.y >= node.rect.y && point.y <= node.rect.y + node.rect.h)
    .sort((left, right) => left.rect.w * left.rect.h - right.rect.w * right.rect.h)[0]
}

function browserOutlineNode(value: unknown): value is BrowserOutlineNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as { ref?: unknown; role?: unknown; name?: unknown; selector?: unknown; rect?: unknown }
  if (typeof node.ref !== 'string' || typeof node.role !== 'string' || typeof node.name !== 'string' || typeof node.selector !== 'string') return false
  if (typeof node.rect !== 'object' || node.rect === null) return false
  const rect = node.rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
  return [rect.x, rect.y, rect.w, rect.h].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
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
