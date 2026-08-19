import { describe, expect, it } from 'vitest'
import { SIDEBAR_CSS } from '../src/client/css.ts'
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

  it('keeps long Markdown previews inside a scrollable flex child', () => {
    expect(SIDEBAR_CSS).toMatch(/\.dcs-md\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow:\s*auto/s)
  })

  it('recognizes headings in CRLF Markdown files', () => {
    const blocks = parseMarkdown('# Verification Report\r\n\r\n### Key Link Verification\r\n')
    expect(blocks.map((block) => block.type)).toEqual(['h', 'h'])
  })

  it('hides YAML frontmatter from the rendered Markdown blocks', () => {
    const blocks = parseMarkdown('---\nphase: 06-quick-wins\nstatus: gaps_found\n---\n\n# Verification Report')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'h', level: 1, line: 6 })
  })

  it('keeps execute-plan XML sections and unfenced Dart readable', () => {
    const blocks = parseMarkdown([
      '---',
      'phase: 06-quick-wins',
      '---',
      '',
      '<objective>',
      'Wire AddSingleGameFlow after game selection.',
      '',
      'Purpose: Close the orphaned page.',
      '</objective>',
      '',
      '<interfaces>',
      '<!-- From app_router.dart -->',
      'GoRoute(',
      "  path: '/library/metadata-editor',",
      '  child: MetadataEditorPage(folderPath: folderPath),',
      ')',
      '</interfaces>',
      '',
      '<name>Task 1: Replace inline step</name>',
    ].join('\n'))
    expect(blocks.map((block) => block.type)).toEqual(['h', 'p', 'p', 'h', 'quote', 'code', 'p'])
    expect(blocks[0]).toMatchObject({ type: 'h', level: 2, inlines: [{ kind: 'text', text: 'Objective' }] })
    expect(blocks[5]).toMatchObject({ type: 'code' })
    expect(blocks[5] && blocks[5].type === 'code' ? blocks[5].text : '').toContain('GoRoute(')
    expect(blocks[5] && blocks[5].type === 'code' ? blocks[5].text : '').toContain('MetadataEditorPage')
    expect(blocks[6]).toMatchObject({
      type: 'p',
      inlines: [{ kind: 'strong', text: 'Name' }, { kind: 'text', text: ': Task 1: Replace inline step' }],
    })
  })

  it('parses verification-report tables without swallowing the following heading', () => {
    const blocks = parseMarkdown([
      '### Required Artifacts',
      '',
      '| Artifact | Expected | Status |',
      '|----------|----------|--------|',
      '| `test/core/audio/portal_sound_provider_test.dart` | Unit tests | VERIFIED |',
      '',
      '### Key Link Verification',
    ].join('\n'))

    expect(blocks.map((block) => block.type)).toEqual(['h', 'table', 'h'])
    expect(blocks[1]).toMatchObject({
      type: 'table',
      line: 3,
      headers: [[{ kind: 'text', text: 'Artifact' }], [{ kind: 'text', text: 'Expected' }], [{ kind: 'text', text: 'Status' }]],
      rows: [[[{ kind: 'code', text: 'test/core/audio/portal_sound_provider_test.dart' }], [{ kind: 'text', text: 'Unit tests' }], [{ kind: 'text', text: 'VERIFIED' }]]],
    })
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
