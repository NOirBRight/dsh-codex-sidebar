import { describe, expect, it } from 'vitest'
import { annotationDraftProjection, stripAnnotationDraftSentinel } from '../src/client/annotation-draft.ts'

describe('annotation composer draft bridge', () => {
  it('makes an empty text-only composer submit-ready while annotations exist', () => {
    expect(annotationDraftProjection('', 1, 0)).toBe('\u200b')
    expect(annotationDraftProjection('   ', 2, 0)).toBe('   \u200b')
  })

  it('does not add a sentinel when text or an image already enables submit', () => {
    expect(annotationDraftProjection('hello', 1, 0)).toBe('hello')
    expect(annotationDraftProjection('', 1, 1)).toBe('')
  })

  it('removes only the trailing sentinel owned by an annotation-only draft', () => {
    expect(stripAnnotationDraftSentinel(' \t\u200b')).toBe(' \t')
    expect(annotationDraftProjection('\u200b', 0, 0)).toBe('')
    expect(annotationDraftProjection('   \u200b', 0, 0)).toBe('   ')
  })

  it('preserves user-authored zero-width spaces in visible text', () => {
    expect(stripAnnotationDraftSentinel('\u200bhello')).toBe('\u200bhello')
    expect(stripAnnotationDraftSentinel('hel\u200blo')).toBe('hel\u200blo')
    expect(stripAnnotationDraftSentinel('hello\u200b')).toBe('hello\u200b')
  })
})
