/** One transcript MutationObserver for tool stats, 批注 chips, and path links. */
export declare const TRANSCRIPT_ROW = "[data-chat-flow-kind], [data-tool]";
export declare const TRANSCRIPT_HOST = "[data-chat-flow], [data-side=\"center\"]";
export declare const TRANSCRIPT_PAINT_MIN_MS = 200;
export declare const MAX_INCREMENTAL_ROOTS = 20;
export type TranscriptDecoratorPaints = {
    paintStats: (root?: ParentNode) => void;
    paintChips: (root?: ParentNode) => void;
    paintPaths: (root?: ParentNode) => void;
    openPath: (path: string) => void;
};
export type TranscriptPaintData = {
    stats?: boolean;
    chips?: boolean;
};
export type TranscriptDecorators = {
    paintData: (opts?: TranscriptPaintData) => void;
    stop: () => void;
};
export declare function ignoredTranscriptTarget(node: Node | null): boolean;
export declare function transcriptMutationIsIgnored(record: MutationRecord): boolean;
export declare function transcriptRowOf(node: Node | null): Element | null;
export declare function mutationPaintTarget(node: Node | null): Element | null;
export declare function collectAddedTranscriptRoots(record: MutationRecord): Element[];
export declare function transcriptPaintHosts(doc?: Document): ParentNode[];
export declare function createPendingThrottle(paint: () => void, ms: number): {
    schedule: () => void;
    cancel: () => void;
};
export declare function shouldRebindSession(boundId: string | undefined, boundStore: unknown, nextId: string | undefined, nextStore: unknown): boolean;
export declare function installTranscriptDecorators(paints: TranscriptDecoratorPaints): TranscriptDecorators;
//# sourceMappingURL=transcript-decorators.d.ts.map