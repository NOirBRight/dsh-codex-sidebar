import { describe, expect, it } from 'vitest'
import { fileCaption, fromFileMark, parsePathLine } from '../src/annotation.ts'
import { formatSend } from '../src/send-text.ts'

describe('formatSend', () => {
  it('numbers 批注 with short captions and does not repeat the draft', () => {
    expect(formatSend('111', [
      { id: 'b1', text: '111', from: 'OfficialOpenAIUsagePanel · section', source: 'browser', selector: 'section.grid' },
      { id: 'b2', text: '111', from: 'Models · div', source: 'browser' },
    ])).toBe([
      '批注 1 · OfficialOpenAIUsagePanel · section',
      '`section.grid`',
      '111',
      '',
      '批注 2 · Models · div',
      '111',
    ].join('\n'))
  })

  it('keeps a title-only row when the note is empty', () => {
    expect(formatSend('', [
      { id: 'b1', text: '', from: 'h1.signin', source: 'browser' },
    ])).toBe('批注 1 · h1.signin')
  })

  it('prepends the 主会话 draft when it is not already a 批注 body', () => {
    expect(formatSend('please fix these', [
      { id: 't1', text: 'heading', from: 'Login.tsx:1', source: 'files', selector: 'src/Login.tsx:1' },
    ])).toBe([
      'please fix these',
      '',
      '批注 1 · Login.tsx:1',
      '`src/Login.tsx:1`',
      'heading',
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
})
