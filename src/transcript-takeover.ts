/** Link takeover is for the 主会话 transcript, not 侧栏 chrome or other columns. */

export type TranscriptClickCaptureRoot = {
  addEventListener(type: 'click', listener: (event: unknown) => void, capture: true): void
}

/** Install above both React's root capture and document-level shell handlers. */
export function installTranscriptClickCapture(
  roots: readonly TranscriptClickCaptureRoot[],
  listener: (event: unknown) => void,
): void {
  for (const root of new Set(roots)) root.addEventListener('click', listener, true)
}

export function allowTranscriptClick(
  event: { defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  explicitlyDecorated: boolean,
): boolean {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  return !event.defaultPrevented || explicitlyDecorated
}

export function allowTranscriptTakeover(
  closest: (selector: string) => unknown,
): boolean {
  if (closest('.dcs-root, .dcs-col, [data-shell-overlay]')) return false
  if (closest('[data-side="details"], [data-side="sidebar"]')) return false
  if (closest('[data-side="center"]')) return true
  if (closest('[data-side]')) return false
  return true
}
