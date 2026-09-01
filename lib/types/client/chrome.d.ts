/** Placement of the 侧栏开关 and resize handle. */
/** Overlay 侧栏开关 stays mounted whenever a 主会话 is open. */
export declare function overlayToggleVisible(sessionId: string | undefined): boolean;
/** Overlay resize handle only while the 侧栏 is open. */
export declare function overlayHandleVisible(collapsed: boolean | undefined): boolean;
/** Pixel offset of the details seam relative to the handle's positioning origin. */
export declare function seamOffsetPx(originLeft: number, detailsLeft: number): number;
//# sourceMappingURL=chrome.d.ts.map