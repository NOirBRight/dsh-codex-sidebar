import { afterEach, describe, expect, it, vi } from 'vitest'
import { decorate, sourceForFlowKey } from '../src/client/annotation-chips.ts'
import type { Annotation } from '../src/session.ts'

describe('sourceForFlowKey', () => {
  it('reads source from Map or record chat nodes', () => {
    const source = { kind: 'user', annotations: [{ id: 'a1' }] }
    expect(sourceForFlowKey({ nodes: { get: (key: string) => key === 'n1' ? { data: { source } } : undefined } }, 'n1')).toEqual(source)
    expect(sourceForFlowKey({ chat: { nodes: new Map([['n1', { data: { source } }]]) } }, 'n1')).toEqual(source)
    expect(sourceForFlowKey({ chat: { nodes: { n1: { data: { source } } } } }, 'n1')).toEqual(source)
    expect(sourceForFlowKey({ chat: { nodes: {} } }, 'n1')).toBeUndefined()
  })
})

class FakeNode {
  className = ''
  parentElement: FakeNode | null = null
  readonly children: FakeNode[] = []
  readonly dataset: Record<string, string> = {}
  textContent = ''
  tagName: string
  type = ''
  private readonly attrs = new Map<string, string>()
  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  replaceChildren = vi.fn((...nodes: FakeNode[]) => {
    for (const child of [...this.children]) this.removeChild(child)
    this.append(...nodes)
  })

  constructor(tagName: string) {
    this.tagName = tagName
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }

  removeChild(node: FakeNode): void {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentElement = null
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeNode[] {
    const found: FakeNode[] = []
    const visit = (node: FakeNode, direct: boolean): void => {
      for (const child of node.children) {
        if (matches(child, selector, direct)) found.push(child)
        visit(child, false)
      }
    }
    visit(this, selector.startsWith(':scope > '))
    return found
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  click(): void {
    for (const handler of this.listeners.get('click') ?? []) handler({} as Event)
  }
}

function matches(node: FakeNode, selector: string, direct: boolean): boolean {
  const raw = selector.startsWith(':scope > ') ? selector.slice(':scope > '.length) : selector
  if (direct === false && selector.startsWith(':scope > ')) return false
  if (raw.includes(',')) return raw.split(',').some((part) => matches(node, part.trim(), direct))
  if (raw.startsWith('.')) return node.className.split(/\s+/).includes(raw.slice(1))
  const attr = raw.match(/^\[([^=]+)="([^"]+)"\]$/)
  if (attr !== null) return node.getAttribute(attr[1] ?? '') === attr[2]
  return false
}

class FakeHTMLElement extends FakeNode {}
class FakeHTMLButtonElement extends FakeHTMLElement {
  constructor() {
    super('BUTTON')
    this.type = 'button'
  }
}

function userRow(key: string): FakeHTMLElement {
  const row = new FakeHTMLElement('DIV')
  row.setAttribute('data-chat-flow-kind', 'user')
  row.setAttribute('data-chat-flow-key', key)
  return row
}

function mark(id: string, from: string) {
  return { id, from, source: 'files' as const }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('annotation chip decorate', () => {
  it('skips replaceChildren when marks and session stay the same', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('HTMLButtonElement', FakeHTMLButtonElement)
    vi.stubGlobal('Element', FakeHTMLElement)
    vi.stubGlobal('document', {
      createElement: (tag: string) => tag === 'button' ? new FakeHTMLButtonElement() : new FakeHTMLElement(tag.toUpperCase()),
    })
    const root = new FakeHTMLElement('MAIN')
    const row = userRow('n1')
    root.append(row)
    const ports = {
      sessionId: () => 's1',
      nodeSource: () => ({ annotations: [mark('a1', 'file.ts')] }),
      reveal: vi.fn(),
      label: (n: number, from: string) => `${n}:${from}`,
    }
    decorate(ports, root as never)
    const host = row.children[0]
    expect(host?.replaceChildren).toHaveBeenCalledTimes(1)
    decorate(ports, root as never)
    expect(host?.replaceChildren).toHaveBeenCalledTimes(1)
  })

  it('rebuilds when marks change and clicks reveal the latest mark', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('HTMLButtonElement', FakeHTMLButtonElement)
    vi.stubGlobal('Element', FakeHTMLElement)
    vi.stubGlobal('document', {
      createElement: (tag: string) => tag === 'button' ? new FakeHTMLButtonElement() : new FakeHTMLElement(tag.toUpperCase()),
    })
    const root = new FakeHTMLElement('MAIN')
    const row = userRow('n1')
    root.append(row)
    const revealed: Annotation[] = []
    let from = 'old.ts'
    const ports = {
      sessionId: () => 's1',
      nodeSource: () => ({ annotations: [mark('a1', from)] }),
      reveal: (_sessionId: string, item: Annotation) => { revealed.push(item) },
      label: (n: number, name: string) => `${n}:${name}`,
    }
    decorate(ports, root as never)
    from = 'new.ts'
    decorate(ports, root as never)
    const host = row.children[0]
    expect(host?.replaceChildren).toHaveBeenCalledTimes(2)
    const button = host?.children[0] as FakeHTMLButtonElement
    button.click()
    expect(revealed[0]?.from).toBe('new.ts')
  })

  it('removes chips when marks disappear', () => {
    vi.stubGlobal('HTMLElement', FakeHTMLElement)
    vi.stubGlobal('HTMLButtonElement', FakeHTMLButtonElement)
    vi.stubGlobal('Element', FakeHTMLElement)
    vi.stubGlobal('document', {
      createElement: (tag: string) => tag === 'button' ? new FakeHTMLButtonElement() : new FakeHTMLElement(tag.toUpperCase()),
    })
    const root = new FakeHTMLElement('MAIN')
    const row = userRow('n1')
    root.append(row)
    let annotations: unknown[] | undefined = [mark('a1', 'file.ts')]
    const ports = {
      sessionId: () => 's1',
      nodeSource: () => annotations === undefined ? undefined : { annotations },
      reveal: vi.fn(),
      label: (n: number, from: string) => `${n}:${from}`,
    }
    decorate(ports, root as never)
    expect(row.children).toHaveLength(1)
    annotations = undefined
    decorate(ports, root as never)
    expect(row.children).toHaveLength(0)
  })
})
