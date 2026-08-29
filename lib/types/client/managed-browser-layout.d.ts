import { type BrowserDevice } from '../browser.ts';
export type ManagedBrowserSize = {
    width: number;
    height: number;
};
export type ManagedBrowserLayoutMode = BrowserDevice;
export type ManagedBrowserLayoutCommit = {
    revision: number;
    mode: ManagedBrowserLayoutMode;
    viewport: ManagedBrowserSize;
    mediaGeneration: number;
};
export type ManagedBrowserLayoutFrame = {
    revision: number;
    mediaGeneration: number;
    viewport: ManagedBrowserSize;
    encodedSize: ManagedBrowserSize;
    /** Diagnostic CDP device dimensions; never presentation geometry. */
    deviceSize?: ManagedBrowserSize;
};
export type ManagedBrowserLayoutProposal = {
    proposalSequence: number;
    mode: ManagedBrowserLayoutMode;
    viewport: ManagedBrowserSize;
};
export type ManagedBrowserLayoutClientOptions = {
    mode: ManagedBrowserLayoutMode;
    settleMs: number;
    hysteresisPx: number;
    viewportLimits: {
        min: ManagedBrowserSize;
        max: ManagedBrowserSize;
    };
};
export type ManagedBrowserLayoutSnapshot = {
    mode: ManagedBrowserLayoutMode;
    containerSize?: ManagedBrowserSize;
    committed?: ManagedBrowserLayoutCommit;
    presented?: ManagedBrowserLayoutCommit;
    encodedSize?: ManagedBrowserSize;
    inputHeld: boolean;
};
type SurfaceBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
type ContentBox = {
    inlineSize: number;
    blockSize: number;
};
type ContentRect = {
    width: number;
    height: number;
};
type ContentPadding = {
    paddingLeft: string;
    paddingRight: string;
    paddingTop: string;
    paddingBottom: string;
};
/** Read one element's untransformed content dimensions for an initial fit proposal. */
export declare function browserElementContentSize(element: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>, style?: ContentPadding): ManagedBrowserSize | undefined;
/** Read the content box delivered by ResizeObserver without consulting presentation geometry. */
export declare function browserObservedContentSize(entry: {
    contentBoxSize?: readonly ContentBox[] | ContentBox;
    contentRect?: ContentRect;
}): ManagedBrowserSize | undefined;
/** Client-side projection of Host-authoritative Browser layout and presentation. */
export declare class ManagedBrowserLayoutClient {
    #private;
    constructor(options: ManagedBrowserLayoutClientOptions);
    observeContainer(size: ManagedBrowserSize, observedAt: number): void;
    selectMode(mode: ManagedBrowserLayoutMode, selectedAt: number): ManagedBrowserLayoutProposal | undefined;
    setImeVisible(visible: boolean, changedAt: number): void;
    proposalDueAt(): number | undefined;
    pollProposal(now: number): ManagedBrowserLayoutProposal | undefined;
    acceptCommit(commit: ManagedBrowserLayoutCommit): boolean;
    acceptFrame(frame: ManagedBrowserLayoutFrame): {
        accepted: boolean;
        switched: boolean;
    };
    inputHeld(): boolean;
    surfaceSize(): ManagedBrowserSize | undefined;
    mapPoint(point: {
        x: number;
        y: number;
    }, surface: SurfaceBounds): {
        revision: number;
        x: number;
        y: number;
    } | undefined;
    snapshot(): ManagedBrowserLayoutSnapshot;
}
/** Fit one committed viewport into a local container without changing either input. */
export declare function browserLayoutSurfaceSize(container: ManagedBrowserSize, viewport: ManagedBrowserSize): ManagedBrowserSize;
export {};
//# sourceMappingURL=managed-browser-layout.d.ts.map