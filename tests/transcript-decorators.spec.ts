import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPendingThrottle,
  ignoredTranscriptTarget,
  installTranscriptDecorators,
  shouldRebindSession,
  transcriptMutationIsIgnored,
} from '../src/client/transcript-decorators.ts'

class FakeElement {
  className: string
  attrs: Record<string, string>
  parentElement: FakeElement | null

  constructor(className = '', attrs: Record<string, string> = {}, parent: FakeElement | null = null) {
    this.className = className
    this.attrs = attrs
    this.parentElement = parent
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this
    while (cur !== null) {
      if (matches(cur, selector)) return cur
      cur = cur.parentElement
    }
    return null
  }
}

function matches(el: FakeElement, selector: string): boolean {
  return selector.split(',').map((part) => part.trim()).some((part) => {
    if (part.startsWith('.')) return el.className.split(/\s+/).includes(part.slice(1))
    const attr = /^\[([^=\]]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]$/.exec(part)
    if (attr === null) return false
    const name = attr[1] ?? ''
    const value = attr[2] ?? attr[3]
    if (value === undefined) return name in el.attrs
    return el.attrs[name] === value
  })
}

class FakeObserver implements MutationObserver {
  static instances: FakeObserver[] = []
  disconnected = false
  readonly observed: Array<{ target: Node; options?: MutationObserverInit }> = []
  private readonly callback: MutationCallback

  constructor(callback: MutationCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }

  observe(target: Node, options?: MutationObserverInit): void {
    this.disconnected = false
    this.observed.push({ target, options })
  }

  disconnect(): void {
    this.disconnected = true
  }

  takeRecords(): MutationRecord[] {
    return []
  }

  deliver(records: MutationRecord[]): void {
    this.callback(records, this)
  }
}

function record(target: FakeElement): MutationRecord {
  return {
    type: 'childList',
    target: target as unknown as Node,
    addedNodes: [] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  }
}

let rafQueue: FrameRequestCallback[] = []
let listeners: Array<(event: Event) => void> = []

afterEach(() => {
  FakeObserver.instances = []
  rafQueue = []
  listeners = []
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubDom(): { root: { id: string } } {
  const root = { id: 'documentElement' }
  rafQueue = []
  listeners = []
  FakeObserver.instances = []
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('MutationObserver', FakeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue[id - 1] = () => {}
  })
  vi.stubGlobal('document', {
    documentElement: root,
    addEventListener(_type: string, fn: (event: Event) => void) {
      listeners.push(fn)
    },
    removeEventListener(_type: string, fn: (event: Event) => void) {
      listeners = listeners.filter((item) => item !== fn)
    },
  })
  return { root }
}

function flushFrame(): void {
  const queued = rafQueue
  rafQueue = []
  for (const cb of queued) cb(0)
}

describe('ignored transcript mutations', () => {
  it('ignores sidebar, details, overlay, and dcs chrome', () => {
    vi.stubGlobal('Element', FakeElement)
    const sidebar = new FakeElement('dcs-root')
    const child = new FakeElement('', {}, sidebar)
    expect(ignoredTranscriptTarget(child as unknown as Node)).toBe(true)
    expect(transcriptMutationIsIgnored(record(child))).toBe(true)
    const details = new FakeElement('', { 'data-side': 'details' })
    expect(transcriptMutationIsIgnored(record(new FakeElement('', {}, details)))).toBe(true)
    expect(transcriptMutationIsIgnored(record(new FakeElement('', { 'data-shell-overlay': '' })))).toBe(true)
  })

  it('paints transcript mutations', () => {
    vi.stubGlobal('Element', FakeElement)
    expect(transcriptMutationIsIgnored(record(new FakeElement('', { 'data-side': 'center' })))).toBe(false)
  })
})

describe('installTranscriptDecorators', () => {
  it('installs one observer and coalesces a burst to one pass', () => {
    stubDom()
    const stats = vi.fn()
    const chips = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips: chips,
      paintPaths: paths,
      openPath() {},
    })
    expect(FakeObserver.instances).toHaveLength(1)
    expect(stats).toHaveBeenCalledTimes(1)
    expect(chips).toHaveBeenCalledTimes(1)
    expect(paths).toHaveBeenCalledTimes(1)

    const observer = FakeObserver.instances[0]!
    const transcript = new FakeElement()
    for (let i = 0; i < 100; i++) observer.deliver([record(transcript)])
    expect(stats).toHaveBeenCalledTimes(1)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(2)
    expect(chips).toHaveBeenCalledTimes(2)
    expect(paths).toHaveBeenCalledTimes(2)
    installed.stop()
  })

  it('does not scan for sidebar-only mutations', () => {
    stubDom()
    const stats = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips() {},
      paintPaths: paths,
      openPath() {},
    })
    FakeObserver.instances[0]!.deliver([record(new FakeElement('dcs-col'))])
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(1)
    expect(paths).toHaveBeenCalledTimes(1)
    installed.stop()
  })

  it('keeps sibling decorators and the observer after one paint throws', () => {
    stubDom()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const chips = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: () => { throw new Error('stats boom') },
      paintChips: chips,
      paintPaths: paths,
      openPath() {},
    })
    expect(chips).toHaveBeenCalledTimes(1)
    expect(paths).toHaveBeenCalledTimes(1)
    expect(FakeObserver.instances[0]?.disconnected).toBe(false)
    installed.stop()
    error.mockRestore()
  })

  it('paintData skips path scans', () => {
    stubDom()
    const stats = vi.fn()
    const chips = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips: chips,
      paintPaths: paths,
      openPath() {},
    })
    installed.paintData()
    expect(stats).toHaveBeenCalledTimes(2)
    expect(chips).toHaveBeenCalledTimes(2)
    expect(paths).toHaveBeenCalledTimes(1)
    installed.stop()
  })

  it('stop disconnects the observer and cancels a pending frame', () => {
    stubDom()
    const stats = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips() {},
      paintPaths() {},
      openPath() {},
    })
    FakeObserver.instances[0]!.deliver([record(new FakeElement())])
    expect(rafQueue).toHaveLength(1)
    installed.stop()
    expect(FakeObserver.instances[0]?.disconnected).toBe(true)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(1)
  })
})

describe('createPendingThrottle', () => {
  it('does not reset the pending timer while events keep arriving', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const throttle = createPendingThrottle(run, 200)
    throttle.schedule()
    vi.advanceTimersByTime(100)
    throttle.schedule()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
    throttle.schedule()
    vi.advanceTimersByTime(200)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('shouldRebindSession', () => {
  it('rebinds on id or store identity change only', () => {
    const store = { id: 1 }
    expect(shouldRebindSession('a', store, 'a', store)).toBe(false)
    expect(shouldRebindSession('a', store, 'b', store)).toBe(true)
    expect(shouldRebindSession('a', store, 'a', { id: 1 })).toBe(true)
  })
})
