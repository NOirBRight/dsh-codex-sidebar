import { describe, expect, it } from 'vitest'
import { fileCaption, fileSnippet, fromFileMark, parsePathLine, toMarkView } from '../src/annotation.ts'
import { projectUserText } from '../src/annotation-message.ts'
import { formatEvidenceSend, formatHumanSend } from '../src/send-text.ts'

describe('formatHumanSend', () => {
  it('keeps an extra 主会话 draft and does not dump locators', () => {
    expect(formatHumanSend('please fix these', [
      { id: 't1', text: 'heading', from: 'Login.tsx:1', source: 'files', selector: 'src/Login.tsx:1' },
    ])).toBe('please fix these')
  })

  it('uses the note body when it is the only human text', () => {
    expect(formatHumanSend('111', [
      { id: 'b1', text: '111', from: 'OfficialOpenAIUsagePanel · section', source: 'browser', selector: 'section.grid' },
    ])).toBe('111')
  })

  it('numbers several note bodies without repeating a shared draft', () => {
    expect(formatHumanSend('111', [
      { id: 'b1', text: '111', from: 'A', source: 'browser' },
      { id: 'b2', text: '222', from: 'B', source: 'browser' },
    ])).toBe(['1. 111', '2. 222'].join('\n'))
  })

  it('falls back to captions when every note is empty', () => {
    expect(formatHumanSend('', [
      { id: 'b1', text: '', from: 'h1.signin', source: 'browser' },
    ])).toBe('批注 1 · h1.signin')
  })
})

describe('formatEvidenceSend', () => {
  it('lists locators and selectors without repeating the note body', () => {
    expect(formatEvidenceSend([
      { id: 'b1', text: '111', from: 'OfficialOpenAIUsagePanel · section', source: 'browser', selector: 'section.grid', url: 'https://example.com' },
      { id: 't1', text: 'heading', from: 'Login.tsx:1', source: 'files', selector: 'src/Login.tsx:1', path: 'src/Login.tsx', line: 1 },
    ], { 'src/Login.tsx': '1|export function Login() {' })).toBe([
      '批注 1 · OfficialOpenAIUsagePanel · section',
      '`section.grid`',
      'https://example.com',
      '',
      '批注 2 · Login.tsx:1',
      '`src/Login.tsx:1`',
      '```',
      '1|export function Login() {',
      '```',
    ].join('\n'))
  })
})

describe('file captions', () => {
  it('shortens a path:line mark', () => {
    expect(parsePathLine('src/Login.tsx:3')).toEqual({ path: 'src/Login.tsx', line: 3 })
    expect(fileCaption('src/Login.tsx:3')).toBe('Login.tsx:3')
    expect(fromFileMark('t1', '  bigger  ', 'src/Login.tsx:3')).toEqual({
      id: 't1',
      text: 'bigger',
      from: 'Login.tsx:3',
      source: 'files',
      selector: 'src/Login.tsx:3',
      path: 'src/Login.tsx',
      line: 3,
    })
  })

  it('builds a mark view and a numbered snippet', () => {
    expect(toMarkView(fromFileMark('t1', 'note', 'src/Login.tsx:2'))).toEqual({
      id: 't1',
      from: 'Login.tsx:2',
      source: 'files',
      selector: 'src/Login.tsx:2',
      path: 'src/Login.tsx',
      line: 2,
    })
    expect(fileSnippet(['a','b','c','d','e'].join('\n'), 2, 1)).toBe(['1|a','2|b','3|c'].join('\n'))
  })
})

describe('projectUserText', () => {
  it('keeps plain text and splits /@ tokens', () => {
    expect(projectUserText('hello')).toEqual([{ kind: 'text', text: 'hello' }])
    expect(projectUserText('use /read and @worker please')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'ref', text: '/read' },
      { kind: 'text', text: ' and ' },
      { kind: 'ref', text: '@worker' },
      { kind: 'text', text: ' please' },
    ])
  })
})
