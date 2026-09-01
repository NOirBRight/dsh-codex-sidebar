import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectAddedTranscriptRoots,
  createPendingThrottle,
  ignoredTranscriptTarget,
  installTranscriptDecorators,
  MAX_INCREMENTAL_ROOTS,
  mutationPaintTarget,
  shouldRebindSession,
  transcriptMutationIsIgnored,
  transcriptPaintHosts,
  transcriptRowOf,
} from '../src/client/transcript-decorators.ts'

class FakeElement {
  className: string
  attrs: Record<string, string>
  parentElement: FakeElement | null
  children: FakeElement[] = []

  constructor(className = '', attrs: Record<string, string> = {}, parent: FakeElement | null = null) {
    this.className = className
    this.attrs = attrs
    this.parentElement = parent
    parent?.children.push(this)
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this
    while (cur !== null) {
      if (matches(cur, selector)) return cur
      cur = cur.parentElement
    }
    return null
  }

  matches(selector: string): boolean {
    return matches(this, selector)
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = []
    const walk = (el: FakeElement): void => {
      for (const child of el.children) {
        if (matches(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
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

function record(target: FakeElement, added: FakeElement[] = []): MutationRecord {
  return {
    type: 'childList',
    target: target as unknown as Node,
    addedNodes: added as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  }
}

let rafQueue: FrameRequestCallback[] = []
let listeners: Array<{ type: string; fn: (event: Event) => void }> = []

afterEach(() => {
  FakeObserver.instances = []
  rafQueue = []
  listeners = []
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubDom(): { root: { id: string }; page: { hidden: boolean }; queryAll: ReturnType<typeof vi.fn>; fire: (type: string) => void } {
  const root = { id: 'documentElement' }
  const page = { hidden: false }
  const queryAll = vi.fn(() => [])
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
    hidden: false,
    querySelectorAll: queryAll,
    addEventListener(type: string, fn: (event: Event) => void) {
      listeners.push({ type, fn })
    },
    removeEventListener(type: string, fn: (event: Event) => void) {
      listeners = listeners.filter((item) => item.type !== type || item.fn !== fn)
    },
  })
  Object.defineProperty(page, 'hidden', {
    get: () => (document as unknown as { hidden: boolean }).hidden,
    set: (value: boolean) => { (document as unknown as { hidden: boolean }).hidden = value },
  })
  return { root, page, queryAll, fire: (type) => { for (const item of [...listeners]) if (item.type === type) item.fn(new Event(type)) } }
}

function flushFrame(): void {
  const queued = rafQueue
  rafQueue = []
  for (const cb of queued) cb(0)
}

function toolRow(): FakeElement {
  return new FakeElement('', { 'data-tool': 'edit' })
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

  it('paints transcript rows and ignores composer chrome', () => {
    vi.stubGlobal('Element', FakeElement)
    expect(transcriptMutationIsIgnored(record(new FakeElement('', { 'data-side': 'center' })))).toBe(false)
    expect(mutationPaintTarget(new FakeElement('dcs-root') as unknown as Node)).toBeNull()
    expect(transcriptRowOf(new FakeElement() as unknown as Node)).toBeNull()
    expect(transcriptRowOf(toolRow() as unknown as Node)).toBeInstanceOf(FakeElement)
    const composer = new FakeElement('', { 'data-composer-seat': '' })
    const trigger = new FakeElement('', {}, composer)
    expect(collectAddedTranscriptRoots(record(composer, [trigger]))).toEqual([])
  })

  it('collects tool rows nested in a replaced wrapper, not the wrapper itself', () => {
    vi.stubGlobal('Element', FakeElement)
    const center = new FakeElement('', { 'data-side': 'center' })
    const row = new FakeElement('', { 'data-tool': 'write' }, center)
    expect(collectAddedTranscriptRoots(record(center, [center]))).toEqual([row])
  })
})

describe('transcriptPaintHosts', () => {
  it('falls back to the document when no chat flow host exists', () => {
    const doc = { querySelectorAll: () => [] } as unknown as Document
    expect(transcriptPaintHosts(doc)).toEqual([doc])
  })
})

describe('installTranscriptDecorators', () => {
  it('installs one observer and coalesces a burst to one pass', () => {
    vi.useFakeTimers()
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
    const transcript = toolRow()
    for (let i = 0; i < 100; i++) observer.deliver([record(transcript, [transcript])])
    expect(stats).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(2)
    expect(chips).toHaveBeenCalledTimes(2)
    expect(paths).toHaveBeenCalledTimes(2)
    expect(stats).toHaveBeenLastCalledWith(transcript)
    installed.stop()
  })

  it('does not paint when the model picker mutates composer chrome', () => {
    vi.useFakeTimers()
    stubDom()
    const stats = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips() {},
      paintPaths: paths,
      openPath() {},
    })
    const composer = new FakeElement('', { 'data-composer-seat': '' })
    const menu = new FakeElement('', {}, composer)
    FakeObserver.instances[0]!.deliver([record(composer, [menu])])
    vi.advanceTimersByTime(200)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(1)
    expect(paths).toHaveBeenCalledTimes(1)
    installed.stop()
  })

  it('drains a large mutation burst with bounded row paints and no host rescan', () => {
    vi.useFakeTimers()
    const dom = stubDom()
    const stats = vi.fn()
    const chips = vi.fn()
    const paths = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips: chips,
      paintPaths: paths,
      openPath() {},
    })
    const observer = FakeObserver.instances[0]!
    const rows = Array.from({ length: 100 }, () => toolRow())
    observer.deliver(rows.map((row) => record(row, [row])))
    expect(stats).toHaveBeenCalledTimes(1)
    expect(dom.queryAll).toHaveBeenCalledTimes(1)

    for (let frame = 0; frame < Math.ceil(rows.length / MAX_INCREMENTAL_ROOTS); frame++) {
      vi.advanceTimersByTime(200)
      flushFrame()
      expect(stats).toHaveBeenCalledTimes(1 + Math.min((frame + 1) * MAX_INCREMENTAL_ROOTS, rows.length))
    }

    expect(stats.mock.calls.slice(1).map(([root]) => root)).toEqual(rows)
    expect(chips).toHaveBeenCalledTimes(1 + rows.length)
    expect(paths).toHaveBeenCalledTimes(1 + rows.length)
    expect(dom.queryAll).toHaveBeenCalledTimes(1)
    installed.stop()
  })

  it('pauses pending work while hidden and resumes with one bounded repaint', () => {
    vi.useFakeTimers()
    const dom = stubDom()
    const stats = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips() {},
      paintPaths() {},
      openPath() {},
    })
    const observer = FakeObserver.instances[0]!
    const row = toolRow()
    observer.deliver([record(row, [row])])
    dom.page.hidden = true
    dom.fire('visibilitychange')
    vi.advanceTimersByTime(1000)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(1)

    dom.page.hidden = false
    dom.fire('visibilitychange')
    expect(stats).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    flushFrame()
    expect(stats).toHaveBeenCalledTimes(2)
    expect(dom.queryAll).toHaveBeenCalledTimes(1)

    installed.stop()
    expect(listeners).toHaveLength(0)
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

  it('paintData can skip stats when only chips changed', () => {
    stubDom()
    const stats = vi.fn()
    const chips = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips: chips,
      paintPaths() {},
      openPath() {},
    })
    installed.paintData({ stats: false, chips: true })
    expect(stats).toHaveBeenCalledTimes(1)
    expect(chips).toHaveBeenCalledTimes(2)
    installed.stop()
  })

  it('stop disconnects the observer and cancels a pending frame', () => {
    vi.useFakeTimers()
    stubDom()
    const stats = vi.fn()
    const installed = installTranscriptDecorators({
      paintStats: stats,
      paintChips() {},
      paintPaths() {},
      openPath() {},
    })
    const row = toolRow()
    FakeObserver.instances[0]!.deliver([record(row, [row])])
    installed.stop()
    expect(FakeObserver.instances[0]?.disconnected).toBe(true)
    vi.advanceTimersByTime(200)
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
