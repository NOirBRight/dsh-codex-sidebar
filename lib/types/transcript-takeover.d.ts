/** Link takeover is for the 主会话 transcript, not 侧栏 chrome or other columns. */
export type TranscriptClickCaptureRoot = {
    addEventListener(type: 'click', listener: (event: unknown) => void, capture: true): void;
};
/** Install above both React's root capture and document-level shell handlers. */
export declare function installTranscriptClickCapture(roots: readonly TranscriptClickCaptureRoot[], listener: (event: unknown) => void): void;
export declare function allowTranscriptTakeover(closest: (selector: string) => unknown): boolean;
//# sourceMappingURL=transcript-takeover.d.ts.map