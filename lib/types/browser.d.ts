/** Browser 工具: navigable page + 批注. Does not start the project. */
import type { Annotation, AnnotationRect, BrowserEvidence, Effect } from './session.ts';
export type PageElement = {
    selector: string;
    text: string;
};
export type PageDocument = {
    url: string;
    title: string;
    html?: string;
    elements: PageElement[];
};
export type BrowserStatus = 'empty' | 'loaded' | 'unreachable';
export type BrowserRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'crashed';
export type BrowserDevice = 'fit' | 'phone' | 'tablet' | 'laptop';
export type BrowserDevicePreset = {
    id: BrowserDevice;
    label: string;
    width?: number;
    height?: number;
};
export declare const BROWSER_DEVICE_PRESETS: readonly BrowserDevicePreset[];
export declare function browserDeviceViewport(device: BrowserDevice): {
    width: number;
    height: number;
} | null;
export declare function normalizeBrowserDevice(value: unknown): BrowserDevice;
export type BrowserIntent = {
    type: 'open-url';
    url: string;
    reveal?: boolean;
} | {
    type: 'browser-follow';
    url: string;
} | {
    type: 'browser-back';
} | {
    type: 'browser-forward';
} | {
    type: 'browser-refresh';
} | {
    type: 'browser-set-device';
    device: BrowserDevice;
} | {
    type: 'browser-open-external';
} | {
    type: 'browser-runtime-sync';
    tabId: string;
    url: string;
    title: string;
    documentId: string;
    status: BrowserRuntimeStatus;
    error?: string;
} | {
    type: 'browser-set-annotate';
    on: boolean;
} | {
    type: 'browser-click-content';
    mark: string;
    x: number;
    y: number;
    captureId: string;
    documentId: string;
    layoutRevision: number;
    mediaGeneration: number;
    selector?: string;
    rect?: AnnotationRect;
} | {
    type: 'browser-dismiss-note';
} | {
    type: 'browser-set-note-draft';
    text: string;
} | {
    type: 'browser-note-add';
    evidence?: BrowserEvidence;
} | {
    type: 'browser-note-send';
    evidence?: BrowserEvidence;
};
export type BrowserPort = {
    load(url: string): PageDocument | undefined;
    openExternal(url: string): void;
    isBusy(): boolean;
    manage?(tabId: string, url: string, action: 'open' | 'back' | 'forward' | 'refresh'): void;
    close?(tabId: string): void;
    spawn?(command: string): void;
};
export type BrowserState = {
    url: string;
    draft: string;
    status: BrowserStatus;
    runtimeStatus: BrowserRuntimeStatus;
    device: BrowserDevice;
    documentId: string | null;
    runtimeError: string | null;
    page: PageDocument | null;
    history: string[];
    index: number;
    canBack: boolean;
    canForward: boolean;
    canAnnotate: boolean;
    annotate: boolean;
    pendingMark: string | null;
    pendingSelector: string | null;
    pendingRect: AnnotationRect | null;
    pendingCaptureId: string | null;
    pendingDocumentId: string | null;
    pendingLayoutRevision: number | null;
    pendingMediaGeneration: number | null;
    pendingEvidence: BrowserEvidence | null;
    notePos: {
        x: number;
        y: number;
    } | null;
    noteDraft: string;
    editingId: string | null;
    attachments: Annotation[];
    seq: number;
};
export declare function emptyBrowser(): BrowserState;
export declare function rememberBrowser(state: Partial<BrowserState> & {
    url?: string;
}): BrowserState;
export declare function hydrateBrowserPages(saved: {
    browser?: BrowserState;
    browsers?: Record<string, BrowserState>;
    tabs?: Array<{
        id: string;
        kind: string | null;
    }>;
    active?: string | null;
} | undefined): Record<string, BrowserState>;
export declare function projectBrowser(state: BrowserState, _port?: BrowserPort): BrowserState;
export declare function syncManagedBrowser(state: BrowserState, projection: {
    url: string;
    title: string;
    documentId: string;
    status: BrowserRuntimeStatus;
    error?: string;
}): BrowserState;
export declare function reduceBrowser(state: BrowserState, intent: {
    type: string;
}, port?: BrowserPort): {
    state: BrowserState;
    effects: Effect[];
} | undefined;
export declare function normalizeUrl(raw: string): string;
export declare function liveHref(url: string): string | undefined;
/** Address that may be opened outside the Host-managed Browser. */
export declare function externalBrowserHref(url: string): string | undefined;
/** HTTP(S) or syntactically valid absolute local HTML address for managed Chromium. */
export declare function managedBrowserHref(url: string): string | undefined;
/** Chromium's failed-navigation page. Never treat this as the address the human asked for. */
export declare function isChromiumErrorUrl(url: string): boolean;
/** 主会话 path takeover: http(s), loopback, and `example.com` — never `README.md`. */
export declare function isTakeoverUrl(raw: string): boolean;
//# sourceMappingURL=browser.d.ts.map