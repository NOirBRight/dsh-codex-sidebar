import { afterEach, describe, expect, it, vi } from 'vitest'
import { decorate, hunkForToolRow } from '../src/client/tool-stats.ts'
import { hunkForOpen, rowHunksFromSnapshot } from '../src/tool-open.ts'

type DiffHunk = { path: string; oldText: string | null; newText: string }

function diffView(...diffs: DiffHunk[]): { card: 'diff'; diffs: DiffHunk[] } {
  return { card: 'diff', diffs }
}

function settled(callId: string, diff: DiffHunk): Record<string, unknown> {
  return {
    kind: 'tool-result',
    callId,
    call: { name: 'edit', argsRaw: '{}' },
    resultView: diffView(diff),
    callView: null,
    subCalls: [],
  }
}

class FakeElement {
  readonly tagName: string
  readonly dataset: Record<string, string> = {}
  parentElement: FakeElement | null = null
  className = ''
  private ownText = ''
  private readonly attrs = new Map<string, string>()
  readonly children: FakeElement[] = []

  constructor(tagName: string) {
    this.tagName = tagName
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.ownText = value
    this.children.length = 0
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  get previousElementSibling(): FakeElement | null {
    if (this.parentElement === null) return null
    const index = this.parentElement.children.indexOf(this)
    return index > 0 ? this.parentElement.children[index - 1] ?? null : null
  }

  after(node: FakeElement): void {
    const parent = this.parentElement
    if (parent === null) return
    node.parentElement?.removeChild(node)
    node.parentElement = parent
    const index = parent.children.indexOf(this)
    parent.children.splice(index + 1, 0, node)
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }

  removeChild(node: FakeElement): void {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentElement = null
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of [...this.children]) this.removeChild(child)
    this.append(...nodes)
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = []
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }

  private matches(selector: string): boolean {
    if (selector === '[data-tool]') return this.attrs.has('data-tool')
    if (selector === 'button') return this.tagName === 'BUTTON'
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1))
    return false
  }
}

class FakeHTMLElement extends FakeElement {}

function toolRow(path: string): FakeHTMLElement {
  const row = new FakeHTMLElement('DIV')
  row.setAttribute('data-tool', 'edit')
  const button = new FakeHTMLElement('BUTTON')
  button.textContent = path
  row.append(button)
  return row
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tool row hunk bridge', () => {
  it('keeps a row-bound hunk exact when the live snapshot changes', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('Element', FakeHTMLElement)
    vi.stubGlobal('Node', FakeHTMLElement)
    vi.stubGlobal('document', { createElement: (tag: string) => new FakeHTMLElement(tag.toUpperCase()) })

    const root = new FakeHTMLElement('MAIN')
    const first = toolRow('src-python/vision_proxy.py')
    const second = toolRow('src-python/vision_proxy.py')
    root.append(first, second)
    const initial = {
      nodes: [
        settled('first', { path: 'src-python/vision_proxy.py', oldText: 'old\n', newText: '' }),
        settled('second', { path: 'src-python/vision_proxy.py', oldText: 'keep\n', newText: 'keep\nplus\n' }),
      ],
      runningCalls: [],
    }

    const rows = rowHunksFromSnapshot(initial)
    decorate(rows, root as never)
    expect(hunkForToolRow(first as never)).toEqual({ before: 'old\n', after: '' })
    expect(hunkForToolRow(second as never)).toEqual({ before: 'keep\n', after: 'keep\nplus\n' })
    expect(first.querySelector('.dcs-tool-stat')?.textContent).toBe('+0−1')
    expect(second.querySelector('.dcs-tool-stat')?.textContent).toBe('+1−0')

    const changed = {
      nodes: [
        settled('new', { path: 'src-python/vision_proxy.py', oldText: 'new\n', newText: 'new\nline\n' }),
        ...initial.nodes,
      ],
      runningCalls: [],
    }
    expect(hunkForOpen(changed, 'vision_proxy.py', 'edit', rows[0]?.hunkId)).toEqual({ before: 'new\n', after: 'new\nline\n' })
    expect(hunkForToolRow(first as never)).toEqual({ before: 'old\n', after: '' })
    expect(hunkForToolRow(second as never)).toEqual({ before: 'keep\n', after: 'keep\nplus\n' })
  })
})
