/** One Host-managed Chromium runtime for every Browser Tab. */
import type { DriveNode, DriveSnapshot } from './browser-drive.ts';
import { LocalHtmlGateway, type LocalHtmlResources } from './local-html-gateway.ts';
import type { BrowserLayout, BrowserLayoutMode, BrowserSize } from './managed-browser-protocol.ts';
import type { BrowserMediaPage } from './managed-browser-webrtc.ts';
export declare const MANAGED_BROWSER_MAX_LIVE_PAGES = 3;
export declare const MANAGED_BROWSER_IDLE_MS = 120000;
export declare const MANAGED_BROWSER_CACHE_BUDGET_BYTES: number;
export declare const PLAYWRIGHT_IGNORE_DEFAULT_ARGS: string[];
export type ManagedTabKey = {
    sessionId: string;
    tabId: string;
};
export type ManagedBrowserConfig = {
    executablePath?: string;
    profileDir?: string;
    headless?: boolean;
    /** Maximum total bytes retained in allowlisted Chromium-derived cache directories. */
    cacheBudgetBytes?: number;
    /** Minimum adaptive CSS viewport accepted from a Browser client. */
    layoutMinViewport?: BrowserSize;
    /** Maximum adaptive CSS viewport accepted from a Browser client. */
    layoutMaxViewport?: BrowserSize;
    /** Time a Browser client waits for an adaptive container measurement to settle. */
    layoutSettleMs?: number;
    /** Pixel jitter ignored by an adaptive Browser client. */
    layoutHysteresisPx?: number;
    /** Raw JPEG ceiling for a same-origin desktop Browser stream frame. */
    desktopJpegMaxRawBytes?: number;
    /** Initial desktop JPEG quality from 1 to 100. */
    desktopJpegQuality?: number;
    /** Minimum milliseconds between desktop JPEG captures. */
    desktopJpegFrameIntervalMs?: number;
    /** Maximum encoded-to-CSS pixel scale for desktop JPEG captures. */
    desktopJpegMaxScale?: number;
    /** Chromium screencast change-signal sampling interval for desktop clients. */
    desktopScreencastEveryNthFrame?: number;
    /** Maximum passive desktop fallback frames emitted after Browser activity. */
    desktopJpegInteractionBurstFrames?: number;
    /** Raw JPEG ceiling before the Mobile tunnel's nested Base64 envelopes. */
    mobileJpegMaxRawBytes?: number;
    /** Initial Mobile JPEG quality from 1 to 100. */
    mobileJpegQuality?: number;
    /** Minimum milliseconds between Mobile JPEG captures. */
    mobileJpegFrameIntervalMs?: number;
    /** Maximum encoded-to-CSS pixel scale for Mobile JPEG captures. */
    mobileJpegMaxScale?: number;
    /** Chromium screencast change-signal sampling interval for Mobile clients. */
    mobileScreencastEveryNthFrame?: number;
    /** Maximum passive Mobile fallback frames emitted after Browser activity. */
    mobileJpegInteractionBurstFrames?: number;
    /** Preferred managed Browser media route. */
    preferredMediaRoute?: 'webrtc-preferred' | 'jpeg-only';
    /** STUN-only ICE server URLs used by managed Browser WebRTC peers. */
    stunUrls?: string[];
    /** Maximum time allowed for one WebRTC negotiation. */
    webrtcNegotiationTimeoutMs?: number;
    /** Minimum delay before retrying a failed WebRTC generation. */
    webrtcRetryCooldownMs?: number;
    /** Maximum concurrent managed Browser WebRTC peers. */
    maxMediaPeers?: number;
    /** Maximum frames per second requested from a direct-video sender. */
    directVideoFrameRate?: number;
    /** Maximum direct-video sender bitrate in bits per second. */
    directVideoMaxBitrate?: number;
    /** Initial JPEG quality used only to feed the direct-video encoder. */
    directVideoCaptureQuality?: number;
    /** Maximum encoded-to-CSS pixel scale used only to feed the direct-video encoder. */
    directVideoCaptureMaxScale?: number;
    /** Raw JPEG ceiling used only between the target Page and direct-video encoder. */
    directVideoCaptureMaxRawBytes?: number;
    /** Dispose an inactive direct-video peer after this many milliseconds. */
    mediaIdleTimeoutMs?: number;
    /** Keep the Browser control connection alive this long after its surface becomes hidden. */
    mediaHideGraceMs?: number;
    /** Maximum time allowed for Chromium to confirm a post-viewport-change paint. */
    layoutPaintTimeoutMs?: number;
    /** Stop waiting for any Browser-owned cleanup after this deadline. */
    browserCleanupTimeoutMs?: number;
    /** Maximum concurrent encoder Pages owned by the managed Browser runtime. */
    maxEncoderPages?: number;
};
export type ManagedBrowserLayoutPolicy = {
    minViewport: BrowserSize;
    maxViewport: BrowserSize;
    settleMs: number;
    hysteresisPx: number;
};
export type ManagedBrowserStatus = 'idle' | 'loading' | 'ready' | 'error' | 'crashed';
export type ManagedBrowserProjection = {
    key: string;
    sessionId: string;
    tabId: string;
    url: string;
    title: string;
    documentId: string;
    status: ManagedBrowserStatus;
    error?: string;
};
export type ManagedBrowserActionResult = {
    ok: true;
} | {
    ok: false;
    code: 'not-ready' | 'stale-ref' | 'unknown-ref' | 'navigation-failed';
    message: string;
};
export type ManagedBrowserCaptureFailure = {
    ok: false;
    code: 'stale-layout';
    message: string;
};
export type ManagedBrowserOutline = {
    documentId: string;
    nodes: DriveNode[];
};
export type ManagedBrowserTrackedRect = {
    documentId: string;
    selector: string;
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
};
export type ManagedBrowserCapture = {
    /** Exact same-process Page/CDP identity that produced this capture. */
    targetIdentity: ManagedBrowserTargetIdentity;
    /** Internal viewport transition epoch that produced this capture. */
    layoutEpoch: number;
    captureId: string;
    documentId: string;
    layoutRevision: number;
    mediaGeneration: number;
    url: string;
    title: string;
    image: Uint8Array;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
    nodes: DriveNode[];
};
type LocatorLike = {
    click(): Promise<void>;
    fill(text: string): Promise<void>;
};
type FrameLike = {
    url(): string;
};
type PageLike = {
    goto(url: string, opts?: {
        waitUntil?: 'domcontentloaded';
        timeout?: number;
    }): Promise<unknown>;
    goBack(opts?: {
        waitUntil?: 'domcontentloaded';
        timeout?: number;
    }): Promise<unknown>;
    goForward(opts?: {
        waitUntil?: 'domcontentloaded';
        timeout?: number;
    }): Promise<unknown>;
    reload(opts?: {
        waitUntil?: 'domcontentloaded';
        timeout?: number;
    }): Promise<unknown>;
    close(): Promise<void>;
    isClosed(): boolean;
    url(): string;
    title(): Promise<string>;
    viewportSize(): {
        width: number;
        height: number;
    } | null;
    setViewportSize(size: {
        width: number;
        height: number;
    }): Promise<void>;
    evaluate<R>(expression: string, argument?: unknown): Promise<R>;
    exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void>;
    screenshot(opts: {
        type: 'jpeg';
        quality: number;
    }): Promise<Uint8Array>;
    locator(selector: string): LocatorLike;
    mainFrame(): FrameLike;
    on(event: 'framenavigated', listener: (frame: FrameLike) => void): void;
    on(event: 'close' | 'crash' | 'domcontentloaded', listener: () => void): void;
    on(event: 'popup', listener: (page: PageLike) => void): void;
};
export type ManagedCdpSession = {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(event: string, listener: (payload: unknown) => void): void;
    off(event: string, listener: (payload: unknown) => void): void;
    detach(): Promise<void>;
};
type ContextLike = {
    newPage(): Promise<PageLike>;
    newCDPSession(page: PageLike): Promise<ManagedCdpSession>;
    on(event: 'close', listener: () => void): void;
    close(): Promise<void>;
};
type LaunchContext = (profileDir: string, opts: {
    executablePath: string;
    headless: boolean;
    viewport: {
        width: number;
        height: number;
    };
    deviceScaleFactor: number;
    ignoreDefaultArgs: string[];
    args: string[];
}) => Promise<ContextLike>;
export type ManagedBrowserRuntimeOptions = ManagedBrowserConfig & {
    launch?: LaunchContext;
    onProjection?: (projection: ManagedBrowserProjection) => void;
    onPopup?: (opener: ManagedTabKey, page: unknown) => void;
    now?: () => number;
    maxLivePages?: number;
    idleMs?: number;
    onWarning?: (message: string) => void;
    localHtmlGateway?: LocalHtmlGateway;
};
type LayoutProposal = {
    mode: BrowserLayoutMode;
    viewport: BrowserSize;
};
declare const managedBrowserTargetIdentity: unique symbol;
/** Opaque object identity for one exact managed Page/CDP record. */
export type ManagedBrowserTargetIdentity = Readonly<{
    readonly [managedBrowserTargetIdentity]: true;
}>;
export declare class ManagedBrowserRuntime {
    #private;
    readonly profileDir: string;
    readonly headless: boolean;
    constructor(opts?: ManagedBrowserRuntimeOptions);
    keyOf(tab: ManagedTabKey): string;
    /**
     * Observe removal of an exact managed Page/CDP target.
     * @param listener - Synchronous observer invoked before owned target teardown starts.
     * @returns A disposer for this exact observer.
     */
    onTargetInvalidated(listener: (tab: ManagedTabKey, identity: ManagedBrowserTargetIdentity) => void): () => void;
    list(): ManagedBrowserProjection[];
    projection(tab: ManagedTabKey): ManagedBrowserProjection | undefined;
    layoutPolicy(): ManagedBrowserLayoutPolicy;
    layout(tab: ManagedTabKey): BrowserLayout | undefined;
    ensure(tab: ManagedTabKey, url: string): Promise<ManagedBrowserProjection>;
    closeSession(sessionId: string): Promise<void>;
    reap(): Promise<void>;
    touch(tab: ManagedTabKey): void;
    acquire(tab: ManagedTabKey): () => void;
    back(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    forward(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    reload(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    resize(tab: ManagedTabKey, width: number, height: number): Promise<void>;
    /** Commit a proposal only when the optional exact target owns the Tab and reports the requested CSS viewport. */
    proposeLayout(tab: ManagedTabKey, proposal: LayoutProposal, expectedTarget?: ManagedBrowserTargetIdentity): Promise<BrowserLayout>;
    /** Reapply one exact committed layout without creating a new revision. */
    verifyLayout(tab: ManagedTabKey, expected: BrowserLayout, expectedTarget: ManagedBrowserTargetIdentity): Promise<BrowserLayout>;
    snapshot(tab: ManagedTabKey): Promise<DriveSnapshot | ManagedBrowserActionResult>;
    /**
     * Read visible outline nodes only while one optional exact target still owns the Tab.
     * @param tab Managed Browser Tab key.
     * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
     * @returns Outline nodes, or a not-ready result when the target is absent or replaced.
     */
    outline(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): Promise<ManagedBrowserOutline | ManagedBrowserActionResult>;
    /**
     * Read one selector rectangle only while one optional exact target still owns the Tab.
     * @param tab Managed Browser Tab key.
     * @param selector CSS selector to measure.
     * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
     * @returns Tracked rectangle, or a not-ready result when the target is absent or replaced.
     */
    trackRect(tab: ManagedTabKey, selector: string, expectedTarget?: ManagedBrowserTargetIdentity): Promise<ManagedBrowserTrackedRect | ManagedBrowserActionResult>;
    click(tab: ManagedTabKey, ref: string): Promise<ManagedBrowserActionResult>;
    fill(tab: ManagedTabKey, ref: string, text: string): Promise<ManagedBrowserActionResult>;
    capture(tab: ManagedTabKey, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<ManagedBrowserCapture | ManagedBrowserActionResult | ManagedBrowserCaptureFailure>;
    /**
     * Return the current public capture identity only while one optional exact target owns the Tab.
     * @param tab Managed Browser Tab key.
     * @param expectedTarget Optional opaque Page/CDP identity captured by the caller.
     * @returns Public document and layout identity, or undefined when the target is absent or replaced.
     */
    captureIdentity(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): {
        documentId: string;
        layoutRevision: number;
        mediaGeneration: number;
        layoutEpoch: number;
    } | undefined;
    /** Resolve one exact target only when its committed viewport is safe for visual reads. */
    target(tab: ManagedTabKey, expectedTarget?: ManagedBrowserTargetIdentity): {
        identity: ManagedBrowserTargetIdentity;
        page: PageLike;
        cdp: ManagedCdpSession;
        documentId: string;
        layout: BrowserLayout;
        layoutEpoch: number;
    } | undefined;
    /** Resolve an exact target owner for control lifecycle checks without granting visual-read readiness. */
    ownedTarget(tab: ManagedTabKey, expectedTarget: ManagedBrowserTargetIdentity): {
        identity: ManagedBrowserTargetIdentity;
        page: PageLike;
        cdp: ManagedCdpSession;
        documentId: string;
        layout: BrowserLayout;
        layoutEpoch: number;
    } | undefined;
    /**
     * Run one browser input atomically with respect to viewport transitions.
     * @param tab Browser Tab owner.
     * @param expectedTarget Exact Page identity accepted for the input.
     * @param expectedLayout Committed revision, document, and internal transition epoch accepted for the input.
     * @param action Complete input gesture to run against the owned CDP session.
     * @returns Whether the gesture ran against the expected target and layout epoch.
     */
    runInput(tab: ManagedTabKey, expectedTarget: ManagedBrowserTargetIdentity, expectedLayout: Pick<BrowserLayout, 'revision'> & {
        layoutEpoch: number;
        documentId: string;
    }, action: (cdp: ManagedCdpSession, targetIsCurrent: () => boolean) => Promise<void>): Promise<boolean>;
    /** Lease one narrow media Page from the same persistent Chromium context. */
    createMediaPage(): Promise<BrowserMediaPage>;
    /** Return the number of owned encoder Pages. */
    mediaPageCount(): number;
    /** Return path-free local HTML gateway lifecycle counters. */
    localHtmlResources(): LocalHtmlResources;
    close(tab: ManagedTabKey): Promise<void>;
    dispose(): Promise<void>;
}
export declare function findBrowserExecutable(explicit?: string): Promise<string>;
export declare function installedPlaywrightChromiumCandidates(cacheRoot: string): Promise<string[]>;
export {};
//# sourceMappingURL=managed-browser-runtime.d.ts.map