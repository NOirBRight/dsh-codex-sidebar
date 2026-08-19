/** Placement of the 侧栏开关 and resize handle. */

/** Overlay 侧栏开关 stays mounted whenever a 主会话 is open. */
export function overlayToggleVisible(sessionId: string | undefined): boolean {
  return sessionId !== undefined
}

/** Overlay resize handle only while the 侧栏 is open. */
export function overlayHandleVisible(collapsed: boolean | undefined): boolean {
  return collapsed === false
}

/** Pixel offset of the details seam relative to the handle's positioning origin. */
export function seamOffsetPx(originLeft: number, detailsLeft: number): number {
  return Math.round(detailsLeft - originLeft)
}
