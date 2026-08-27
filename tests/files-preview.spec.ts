import { describe, expect, it } from 'vitest'
import { filesPreviewPhase, shouldFetchFilePreview } from '../src/client/files-preview.ts'

describe('Files preview on remote/APP clients', () => {
  it('fetches any missing snapshot preview, not just images', () => {
    expect(shouldFetchFilePreview('test_issue_62_runtime_trace.py', undefined)).toBe(true)
    expect(shouldFetchFilePreview('README.md', undefined)).toBe(true)
    expect(shouldFetchFilePreview('logo.png', undefined)).toBe(true)
    expect(shouldFetchFilePreview('note.ts', 'const n = 1\n')).toBe(false)
    expect(shouldFetchFilePreview('', undefined)).toBe(false)
  })

  it('shows 无法读取 only after a fetch is impossible or has failed', () => {
    expect(filesPreviewPhase({
      path: 'test_issue_62_runtime_trace.py',
      preview: undefined,
      fetchFailed: false,
      canFetch: true,
    })).toBe('loading')
    expect(filesPreviewPhase({
      path: 'test_issue_62_runtime_trace.py',
      preview: undefined,
      fetchFailed: true,
      canFetch: true,
    })).toBe('missing')
    expect(filesPreviewPhase({
      path: 'test_issue_62_runtime_trace.py',
      preview: undefined,
      fetchFailed: false,
      canFetch: false,
    })).toBe('missing')
    expect(filesPreviewPhase({
      path: 'test_issue_62_runtime_trace.py',
      preview: 'print("ok")\n',
      fetchFailed: false,
      canFetch: true,
    })).toBe('ready')
    expect(filesPreviewPhase({
      path: '',
      preview: undefined,
      fetchFailed: false,
      canFetch: true,
    })).toBe('empty')
  })
})
