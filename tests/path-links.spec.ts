import { afterEach, describe, expect, it, vi } from 'vitest'
import { decorate, pathFromClick, transcriptPath } from '../src/client/path-links.ts'

class FakeElement {
  readonly tagName: string
  className = ''
  title = ''
  parentElement: FakeElement | null = null
  readonly dataset: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly classList = {
    add: (name: string) => {
      const parts = this.className.split(/\s+/).filter(Boolean)
      if (!parts.includes(name)) parts.push(name)
      this.className = parts.join(' ')
    },
    remove: (name: string) => {
      this.className = this.className.split(/\s+/).filter((part) => part !== name).join(' ')
    },
  }
  private ownText = ''
  private readonly attrs = new Map<string, string>()

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
    if (name === 'title') this.title = value
  }

  getAttribute(name: string): string | null {
    if (name === 'title') return this.title.length === 0 ? null : this.title
    return this.attrs.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name)
    if (name === 'title') this.title = ''
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this
      this.children.push(node)
    }
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this
    while (cur !== null) {
      if (cur.matches(selector)) return cur
      cur = cur.parentElement
    }
    return null
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

  matches(selector: string): boolean {
    return selector.split(',').map((part) => part.trim()).some((part) => this.matchesOne(part))
  }

  private matchesOne(selector: string): boolean {
    if (selector === 'code') return this.tagName === 'CODE'
    if (selector === 'code.dcs-path-link') return this.tagName === 'CODE' && this.className.split(/\s+/).includes('dcs-path-link')
    if (selector === 'a') return this.tagName === 'A'
    if (selector === 'a[href]') return this.tagName === 'A' && this.attrs.has('href')
    if (selector === 'button') return this.tagName === 'BUTTON'
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1))
    const quoted = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector)
    if (quoted !== null) return this.attrs.get(quoted[1] ?? '') === quoted[2]
    const bare = /^\[([^=\]]+)\]$/.exec(selector)
    if (bare !== null) return this.attrs.has(bare[1] ?? '')
    return false
  }
}

class FakeHTMLElement extends FakeElement {}

function code(text: string): FakeHTMLElement {
  const node = new FakeHTMLElement('CODE')
  node.textContent = text
  return node
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubDom(): void {
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  vi.stubGlobal('Element', FakeHTMLElement)
  vi.stubGlobal('Node', FakeHTMLElement)
}

describe('transcript path links', () => {
  it('accepts relative and absolute workspace paths', () => {
    expect(transcriptPath('generated/grok-imagine-probe.png')).toBe('generated/grok-imagine-probe.png')
    expect(transcriptPath('/home/noirbright/development/generated/grok-imagine-probe.png')).toBe(
      '/home/noirbright/development/generated/grok-imagine-probe.png',
    )
    expect(transcriptPath('./src/client/FilesPane.tsx')).toBe('./src/client/FilesPane.tsx')
  })

  it('rejects URLs, commands, and plain words', () => {
    expect(transcriptPath('https://example.com/x.png')).toBeUndefined()
    expect(transcriptPath('git status')).toBeUndefined()
    expect(transcriptPath('flutter')).toBeUndefined()
  })
})

describe('path link decorate and click', () => {
  it('marks transcript HTTP anchors without changing official fallback attributes', () => {
    stubDom()
    const root = new FakeHTMLElement('MAIN')
    const row = new FakeHTMLElement('DIV')
    row.setAttribute('data-chat-flow-kind', 'assistant')
    const anchor = new FakeHTMLElement('A')
    anchor.setAttribute('href', 'https://example.test/docs')
    anchor.setAttribute('target', '_blank')
    row.append(anchor)
    root.append(row)

    decorate(root as never)

    expect(anchor.getAttribute('data-dcs-url')).toBe('https://example.test/docs')
    expect(anchor.getAttribute('href')).toBe('https://example.test/docs')
    expect(anchor.getAttribute('target')).toBe('_blank')

    const outside = new FakeHTMLElement('A')
    outside.setAttribute('href', 'https://example.test/settings')
    root.append(outside)
    decorate(root as never)
    expect(outside.getAttribute('href')).toBe('https://example.test/settings')
    expect(outside.getAttribute('data-dcs-url')).toBeNull()
  })

  it('reuses a code node and opens only the current path once', () => {
    stubDom()
    const root = new FakeHTMLElement('MAIN')
    const node = code('src/a.ts')
    root.append(node)
    decorate(root as never)
    expect(node.dataset.dcsPath).toBe('src/a.ts')
    node.textContent = 'src/b.ts'
    decorate(root as never)
    expect(node.dataset.dcsPath).toBe('src/b.ts')
    expect(pathFromClick({ target: node } as unknown as Event)).toBe('src/b.ts')
  })

  it('clears stale markers and skips excluded surfaces', () => {
    stubDom()
    const root = new FakeHTMLElement('MAIN')
    const live = code('src/live.ts')
    const sidebar = new FakeHTMLElement('DIV')
    sidebar.className = 'dcs-root'
    const hidden = code('src/hidden.ts')
    sidebar.append(hidden)
    const wrapped = new FakeHTMLElement('A')
    const insideLink = code('src/link.ts')
    wrapped.append(insideLink)
    root.append(live, sidebar, wrapped)
    decorate(root as never)
    expect(live.dataset.dcsPath).toBe('src/live.ts')
    expect(hidden.dataset.dcsPath).toBeUndefined()
    expect(insideLink.dataset.dcsPath).toBeUndefined()

    live.textContent = 'not a path'
    decorate(root as never)
    expect(live.dataset.dcsPath).toBeUndefined()
    expect(live.className).not.toContain('dcs-path-link')
    expect(pathFromClick({ target: live } as unknown as Event)).toBeUndefined()
  })

  it('opens official file-mutation path buttons in the sidebar'
    + '', () => {
    stubDom()
    const row = new FakeHTMLElement('DIV')
    row.setAttribute('data-tool', 'edit')
    const btn = new FakeHTMLElement('BUTTON')
    btn.textContent = '~/Workstation/dsh-mobile-pairing/src/tunnel-server.ts'
    row.append(btn)
    expect(pathFromClick({ target: btn } as unknown as Event)).toBe(
      '~/Workstation/dsh-mobile-pairing/src/tunnel-server.ts',
    )
  })
})
