/** Link takeover is for the 主会话 transcript, not 侧栏 chrome or other columns. */

export function allowTranscriptTakeover(
  closest: (selector: string) => unknown,
): boolean {
  if (closest('.dcs-root, .dcs-col, [data-shell-overlay]')) return false
  if (closest('[data-side="details"], [data-side="sidebar"]')) return false
  if (closest('[data-side="center"]')) return true
  if (closest('[data-side]')) return false
  return true
}
