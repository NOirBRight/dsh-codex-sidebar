import { describe, expect, it } from 'vitest'
import { highlightSource, parseInlines, parseMarkdown, previewKind } from '../src/preview.ts'

describe('Files preview rendering', () => {
  it('classifies markdown vs code vs text', () => {
    expect(previewKind('README.md')).toBe('markdown')
    expect(previewKind('src/Login.tsx')).toBe('code')
    expect(previewKind('notes.txt')).toBe('text')
  })

  it('highlights TypeScript keywords, strings, comments, and numbers', () => {
    const [row] = highlightSource('src/a.ts', 'const n = 3 // hi')
    expect(row).toEqual([
      { kind: 'kw', text: 'const' },
      { kind: 'text', text: ' n ' },
      { kind: 'punc', text: '=' },
      { kind: 'text', text: ' ' },
      { kind: 'num', text: '3' },
      { kind: 'text', text: ' ' },
      { kind: 'com', text: '// hi' },
    ])
    const [quoted] = highlightSource('src/a.ts', 'return "Sign in"')
    expect(quoted?.some((tok) => tok.kind === 'str' && tok.text === '"Sign in"')).toBe(true)
    expect(quoted?.some((tok) => tok.kind === 'kw' && tok.text === 'return')).toBe(true)
  })

  it('keeps block comments across lines', () => {
    const rows = highlightSource('a.ts', 'a /*\nkeep\n*/ b')
    expect(rows[0]?.some((tok) => tok.kind === 'com')).toBe(true)
    expect(rows[1]).toEqual([{ kind: 'com', text: 'keep' }])
    expect(rows[2]?.[0]).toEqual({ kind: 'com', text: '*/' })
  })

  it('parses markdown headings, lists, fences, and inlines', () => {
    const blocks = parseMarkdown('# Title\n\nHello **world** and `x`\n\n- one\n- two\n\n```ts\nconst a = 1\n```\n')
    expect(blocks[0]).toMatchObject({ type: 'h', level: 1, line: 1 })
    expect(blocks[1]).toMatchObject({ type: 'p', line: 3 })
    expect(blocks[2]).toMatchObject({ type: 'ul', line: 5 })
    expect(blocks[3]).toMatchObject({ type: 'code', lang: 'ts', text: 'const a = 1' })
    expect(parseInlines('see [docs](https://ex.test) now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://ex.test' },
      { kind: 'text', text: ' now' },
    ])
  })
})
