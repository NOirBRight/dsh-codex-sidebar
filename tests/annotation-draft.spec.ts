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

  it('removes the sentinel once annotations leave or visible text appears', () => {
    expect(annotationDraftProjection('\u200b', 0, 0)).toBe('')
    expect(annotationDraftProjection('\u200bhello', 1, 0)).toBe('hello')
  })

  it('strips every sentinel before prompt formatting', () => {
    expect(stripAnnotationDraftSentinel('\u200bhello\u200b')).toBe('hello')
  })
})
