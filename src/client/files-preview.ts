/** Files preview fetch policy: snapshot bytes when present, otherwise one file-read. */

export function shouldFetchFilePreview(path: string, snapshotPreview: string | undefined): boolean {
  return path.length > 0 && snapshotPreview === undefined
}

export function filesPreviewPhase(input: {
  path: string
  preview: string | undefined
  fetchFailed: boolean
  canFetch: boolean
}): 'empty' | 'loading' | 'missing' | 'ready' {
  if (input.path.length === 0) return 'empty'
  if (input.preview !== undefined) return 'ready'
  if (input.canFetch && !input.fetchFailed) return 'loading'
  return 'missing'
}
