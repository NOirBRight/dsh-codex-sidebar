import { describe, expect, it } from 'vitest'
import {
  BROWSER_PARK_ORIGIN,
  BROWSER_PARK_SIZE,
  BROWSER_WELL_ID,
  browserFrameSurfaceStyle,
  createBrowserFrameHost,
} from '../src/client/browser-frames.ts'

class FakeNode {
  id = ''
  className = ''
  title = ''
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  parentElement: FakeNode | null = null
  children: FakeNode[] = []
  assignments = 0
  blurred = false
  private readonly attrs = new Map<string, string>()

  get src(): string { return this.attrs.get('src') ?? '' }
  set src(value: string) { this.assignments += 1; this.attrs.set('src', value) }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value) }
  appendChild(child: FakeNode): FakeNode {
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }
  removeChild(child: FakeNode): void {
    this.children = this.children.filter((item) => item !== child)
    child.parentElement = null
  }
  remove(): void { this.parentElement?.removeChild(this) }
  blur(): void { this.blurred = true }
}

class FakeDocument {
  readonly body = new FakeNode()
  activeElement: FakeNode | null = null
  createElement(): FakeNode { return new FakeNode() }
  getElementById(id: string): FakeNode | null {
    const visit = (node: FakeNode): FakeNode | null => {
      if (node.id === id) return node
      for (const child of node.children) {
        const found = visit(child)
        if (found !== null) return found
      }
      return null
    }
    return visit(this.body)
  }
}

describe('persistent Browser iframe theater', () => {
  it('attaches once and only changes fixed geometry while docking and parking', () => {
    const doc = new FakeDocument()
    const host = createBrowserFrameHost(doc as unknown as Document)
    const frame = host.ensure('sess:t1', '/__dcs/probe', 'Probe') as unknown as FakeNode
    const well = doc.getElementById(BROWSER_WELL_ID)
    expect(frame.parentElement).toBe(well)
    expect(frame.assignments).toBe(1)

    host.apply('sess:t1', {
      mode: 'dock',
      box: { x: 300, y: 80, w: 640, h: 480 },
      pointerEvents: 'auto',
      visibility: 'visible',
    })
    expect(frame.parentElement).toBe(well)
    expect(frame.style).toMatchObject({ left: '300px', top: '80px', width: '640px', height: '480px', pointerEvents: 'auto' })

    doc.activeElement = frame
    host.apply('sess:t1', { mode: 'park' })
    expect(frame.parentElement).toBe(well)
    expect(frame.blurred).toBe(true)
    expect(frame.style).toMatchObject({
      left: String(BROWSER_PARK_ORIGIN.x) + 'px',
      top: String(BROWSER_PARK_ORIGIN.y) + 'px',
      width: String(BROWSER_PARK_SIZE.w) + 'px',
      height: String(BROWSER_PARK_SIZE.h) + 'px',
      pointerEvents: 'none',
      visibility: 'visible',
    })

    expect(host.ensure('sess:t1', '/__dcs/probe', 'Probe 2')).toBe(frame as unknown as HTMLIFrameElement)
    expect(frame.assignments).toBe(1)
    host.reload('sess:t1')
    expect(frame.assignments).toBe(2)
  })

  it('keeps multiple tabs under one theater and retain removes only dead tabs', () => {
    const doc = new FakeDocument()
    const host = createBrowserFrameHost(doc as unknown as Document)
    const first = host.ensure('sess:t1', '/one', 'One') as unknown as FakeNode
    const second = host.ensure('sess:t2', '/two', 'Two') as unknown as FakeNode
    expect(first.parentElement).toBe(second.parentElement)
    expect(first.parentElement?.children).toHaveLength(2)
    host.retain(new Set(['sess:t1']))
    expect(host.get('sess:t1')).toBeDefined()
    expect(host.get('sess:t2')).toBeUndefined()
    expect(first.parentElement?.children).toEqual([first])
  })

  it('makes blocked docks passive and hidden without collapsing their box', () => {
    expect(browserFrameSurfaceStyle({
      mode: 'dock',
      box: { x: 10, y: 20, w: 300, h: 200 },
      pointerEvents: 'none',
      visibility: 'hidden',
    })).toMatchObject({ left: '10px', top: '20px', width: '300px', height: '200px', pointerEvents: 'none', visibility: 'hidden' })
  })
})
