/** One Host-managed Chromium runtime for every Browser Tab. */
import type { DriveNode, DriveSnapshot } from './browser-drive.ts';
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
    captureId: string;
    documentId: string;
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
    evaluate<R>(expression: string): Promise<R>;
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
type CacheCleanup = (profileDir: string, budgetBytes: number, mayDelete: () => Promise<boolean>) => Promise<void>;
export type ManagedBrowserRuntimeOptions = ManagedBrowserConfig & {
    launch?: LaunchContext;
    onProjection?: (projection: ManagedBrowserProjection) => void;
    onPopup?: (opener: ManagedTabKey, page: unknown) => void;
    now?: () => number;
    maxLivePages?: number;
    idleMs?: number;
    onWarning?: (message: string) => void;
    cleanupDerivedCaches?: CacheCleanup;
    profileLeaseTimeoutMs?: number;
};
export declare class ManagedBrowserRuntime {
    #private;
    readonly profileDir: string;
    readonly headless: boolean;
    constructor(opts?: ManagedBrowserRuntimeOptions);
    keyOf(tab: ManagedTabKey): string;
    list(): ManagedBrowserProjection[];
    projection(tab: ManagedTabKey): ManagedBrowserProjection | undefined;
    ensure(tab: ManagedTabKey, url: string): Promise<ManagedBrowserProjection>;
    closeSession(sessionId: string): Promise<void>;
    reap(): Promise<void>;
    touch(tab: ManagedTabKey): void;
    back(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    forward(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    reload(tab: ManagedTabKey): Promise<ManagedBrowserProjection | undefined>;
    resize(tab: ManagedTabKey, width: number, height: number): Promise<void>;
    snapshot(tab: ManagedTabKey): Promise<DriveSnapshot | ManagedBrowserActionResult>;
    outline(tab: ManagedTabKey): Promise<ManagedBrowserOutline | ManagedBrowserActionResult>;
    trackRect(tab: ManagedTabKey, selector: string): Promise<ManagedBrowserTrackedRect | ManagedBrowserActionResult>;
    click(tab: ManagedTabKey, ref: string): Promise<ManagedBrowserActionResult>;
    fill(tab: ManagedTabKey, ref: string, text: string): Promise<ManagedBrowserActionResult>;
    capture(tab: ManagedTabKey): Promise<ManagedBrowserCapture | ManagedBrowserActionResult>;
    target(tab: ManagedTabKey): {
        page: PageLike;
        cdp: ManagedCdpSession;
        documentId: string;
    } | undefined;
    close(tab: ManagedTabKey): Promise<void>;
    dispose(): Promise<void>;
}
export declare function findBrowserExecutable(explicit?: string): Promise<string>;
export declare function installedPlaywrightChromiumCandidates(cacheRoot: string): Promise<string[]>;
/**
 * Remove only allowlisted derived caches after a caller-supplied ownership recheck.
 * @param profileDir Chromium user-data directory.
 * @param budgetBytes Maximum aggregate bytes allowed for derived caches.
 * @param mayDelete Revalidation performed immediately before each directory removal.
 * @returns A promise that settles after eligible cache directories are inspected and removed.
 */
export declare function cleanupDerivedChromiumCaches(profileDir: string, budgetBytes: number, mayDelete: () => Promise<boolean>): Promise<void>;
export {};
//# sourceMappingURL=managed-browser-runtime.d.ts.map