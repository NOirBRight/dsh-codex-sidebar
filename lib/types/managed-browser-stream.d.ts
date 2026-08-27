/** Authenticated same-origin screencast and input transport for managed Browser Tabs. */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ManagedBrowserRuntime, ManagedCdpSession, ManagedTabKey } from './managed-browser-runtime.ts';
import { type BrowserInput, type BrowserLayout, type BrowserSize, type BrowserRtcCandidate, type BrowserRtcDescription } from './managed-browser-protocol.ts';
import { type BrowserMediaFrame, type ManagedBrowserWebRtcEncoderOptions } from './managed-browser-webrtc.ts';
export declare const MANAGED_BROWSER_STREAM_PATH = "/__dcs/browser-stream";
export declare const MANAGED_BROWSER_STREAM_VERSION = 2;
export declare const MANAGED_BROWSER_STREAM_SHUTDOWN_TIMEOUT_MS = 2000;
export declare const MANAGED_BROWSER_STREAM_HANDSHAKE_TIMEOUT_MS = 5000;
export declare const MANAGED_BROWSER_STREAM_FRAME_INTERVAL_MS = 100;
export declare const MANAGED_BROWSER_STREAM_EVERY_NTH_FRAME = 2;
export declare const MANAGED_BROWSER_MOBILE_FRAME_INTERVAL_MS = 250;
export declare const MANAGED_BROWSER_MOBILE_EVERY_NTH_FRAME = 4;
export declare const MANAGED_BROWSER_MOBILE_MAX_RAW_BYTES: number;
export declare const MANAGED_BROWSER_DESKTOP_MAX_RAW_BYTES: number;
export declare const MANAGED_BROWSER_DIRECT_CAPTURE_MAX_RAW_BYTES: number;
export declare const MANAGED_BROWSER_DESKTOP_INTERACTION_BURST_FRAMES = 20;
export declare const MANAGED_BROWSER_MOBILE_INTERACTION_BURST_FRAMES = 4;
export declare const MANAGED_BROWSER_STREAM_QUALITY = 80;
export declare const MANAGED_BROWSER_DIRECT_CAPTURE_QUALITY = 80;
export declare const MANAGED_BROWSER_DIRECT_CAPTURE_MAX_SCALE = 1.5;
export declare const MANAGED_BROWSER_MOBILE_STREAM_QUALITY = 65;
export declare const MANAGED_BROWSER_MEDIA_IDLE_TIMEOUT_MS: number;
export type BrowserStreamTransportProfile = {
    frameEncoding: 'binary-v2' | 'json-base64-v2';
    quality: number;
    maxScale: number;
    frameIntervalMs: number;
    everyNthFrame: number;
    interactionBurstFrames: number;
    maxRawBytes: number;
};
export type BrowserStreamProfileConfig = {
    desktopJpegMaxRawBytes?: number | undefined;
    desktopJpegQuality?: number | undefined;
    desktopJpegFrameIntervalMs?: number | undefined;
    desktopJpegMaxScale?: number | undefined;
    desktopScreencastEveryNthFrame?: number | undefined;
    desktopJpegInteractionBurstFrames?: number | undefined;
    mobileJpegMaxRawBytes?: number | undefined;
    mobileJpegQuality?: number | undefined;
    mobileJpegFrameIntervalMs?: number | undefined;
    mobileJpegMaxScale?: number | undefined;
    mobileScreencastEveryNthFrame?: number | undefined;
    mobileJpegInteractionBurstFrames?: number | undefined;
};
export type BrowserDirectCaptureProfileConfig = {
    directVideoCaptureQuality?: number | undefined;
    directVideoCaptureMaxScale?: number | undefined;
    directVideoCaptureMaxRawBytes?: number | undefined;
};
export type BrowserDirectCaptureProfile = Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>;
/** Resolve the encoder capture independently from the socket's fallback transport. */
export declare function browserDirectCaptureProfile(config?: BrowserDirectCaptureProfileConfig): BrowserDirectCaptureProfile;
export declare function browserStreamTransportProfile(route: 'desktop' | 'mobile', config?: BrowserStreamProfileConfig): BrowserStreamTransportProfile;
/** Calculates the next capture delay without allowing priority requests to bypass the route FPS ceiling. */
export declare function browserStreamCaptureDelay(lastCapturedAt: number | undefined, now: number, frameIntervalMs: number): number;
/** Bounds passive screencast-driven fallback frames after explicit Browser activity. */
export declare class BrowserFallbackActivityBudget {
    #private;
    constructor(limit: number);
    activate(): void;
    takePassive(directVideo?: boolean): boolean;
    remaining(): number;
}
export declare const MANAGED_BROWSER_STREAM_MAX_WIDTH = 2560;
export declare const MANAGED_BROWSER_STREAM_MAX_HEIGHT = 2048;
export type BrowserStreamTicket = {
    ticket: string;
    path: string;
    expiresAt: number;
};
export type BrowserStreamFrame = {
    version: number;
    sequence: number;
    sentAt: number;
    width: number;
    height: number;
    jpeg: Uint8Array;
};
export type ManagedBrowserStreamOptions = {
    runtime: ManagedBrowserRuntime;
    now?: () => number;
    ticketTtlMs?: number;
    handshakeTimeoutMs?: number;
    desktopMaxRawBytes?: number;
    mobileMaxRawBytes?: number;
    desktopJpegQuality?: number;
    desktopJpegFrameIntervalMs?: number;
    desktopJpegMaxScale?: number;
    desktopScreencastEveryNthFrame?: number;
    desktopJpegInteractionBurstFrames?: number;
    mobileJpegQuality?: number;
    mobileJpegFrameIntervalMs?: number;
    mobileJpegMaxScale?: number;
    mobileScreencastEveryNthFrame?: number;
    mobileJpegInteractionBurstFrames?: number;
    preferredMediaRoute?: 'webrtc-preferred' | 'jpeg-only';
    stunUrls?: string[];
    webrtcNegotiationTimeoutMs?: number;
    webrtcRetryCooldownMs?: number;
    maxMediaPeers?: number;
    directVideoFrameRate?: number;
    directVideoMaxBitrate?: number;
    directVideoCaptureQuality?: number;
    directVideoCaptureMaxScale?: number;
    directVideoCaptureMaxRawBytes?: number;
    mediaIdleTimeoutMs?: number;
    mediaHideGraceMs?: number;
    shutdownTimeoutMs?: number;
    encoderFactory?: ManagedBrowserWebRtcEncoderFactory;
};
export type ManagedBrowserWebRtcEncoderLike = {
    start(): Promise<BrowserRtcDescription>;
    acceptAnswer(description: BrowserRtcDescription): Promise<void>;
    addCandidate(candidate: BrowserRtcCandidate | null): Promise<void>;
    submit(frame: BrowserMediaFrame): boolean;
    dispose(): Promise<void>;
};
export type ManagedBrowserWebRtcEncoderFactory = (options: ManagedBrowserWebRtcEncoderOptions) => ManagedBrowserWebRtcEncoderLike;
export type { BrowserInput } from './managed-browser-protocol.ts';
export type ManagedBrowserStreamResources = {
    sockets: number;
    timers: number;
    captures: number;
    unackedFrames: number;
    peers: number;
};
export type ManagedBrowserMediaRouteDiagnostic = {
    route: 'jpeg-fallback' | 'webrtc-direct';
    status: 'active' | 'degraded' | 'reconnecting';
    reason?: string;
};
export type ManagedBrowserLatencyDiagnostic = {
    samples: number;
    totalMs: number;
    lastMs: number;
    maxMs: number;
};
export type ManagedBrowserStreamDiagnostics = {
    layoutProposals: number;
    layoutCommits: number;
    staleInputs: number;
    staleCaptureDrops: number;
    fallbackBytes: number;
    fallbackRecaptures: number;
    encodedBytes: number;
    routeBudgetDrops: number;
    mediaAttempts: number;
    mediaFailures: number;
    currentViewportRevision: number | undefined;
    currentMediaGeneration: number | undefined;
    captureLatencyMs: ManagedBrowserLatencyDiagnostic;
    encodeLatencyMs: ManagedBrowserLatencyDiagnostic;
    sendLatencyMs: ManagedBrowserLatencyDiagnostic;
    encoderPaintLatencyMs: ManagedBrowserLatencyDiagnostic;
    fallbackAckEndToEndLatencyMs: ManagedBrowserLatencyDiagnostic;
    activePeers: number;
    activeEncoderPages: number;
    activeCaptures: number;
    activeSockets: number;
    activeTimers: number;
    lastMediaRoute: ManagedBrowserMediaRouteDiagnostic | undefined;
    mediaRouteReasons: Record<string, number>;
};
export declare class ManagedBrowserStream {
    #private;
    constructor(opts: ManagedBrowserStreamOptions);
    issue(tab: ManagedTabKey): BrowserStreamTicket;
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    dispose(): Promise<void>;
    closeTab(tab: ManagedTabKey): void;
    closeSession(sessionId: string): void;
    resources(): ManagedBrowserStreamResources;
    /** Return cumulative protocol/media counters without changing owned-resource accounting. */
    diagnostics(): ManagedBrowserStreamDiagnostics;
    consume(ticket: string): ManagedTabKey | undefined;
}
export declare function browserStreamVisualViewportOrigin(value: unknown): {
    x: number;
    y: number;
};
export type BrowserJpegCapture = {
    jpeg: Uint8Array;
    encodedSize: BrowserSize;
    quality: number;
    scale: number;
};
export type BrowserJpegCaptureObserver = {
    onCaptureAttempt?: (attemptIndex: number) => void;
    onStaleDrop?: () => void;
};
/** Capture only while the supplied committed layout remains current. */
export declare function captureBrowserJpegForLayout(cdp: ManagedCdpSession, layout: BrowserLayout, currentLayout: () => BrowserLayout | undefined, profile: Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>, observer?: BrowserJpegCaptureObserver): Promise<BrowserJpegCapture | undefined>;
/** Capture the committed CSS viewport within one route's raw JPEG budget. */
export declare function captureBrowserJpegWithinBudget(cdp: ManagedCdpSession, viewport: BrowserSize, profile: Pick<BrowserStreamTransportProfile, 'quality' | 'maxScale' | 'maxRawBytes'>, observer?: Pick<BrowserJpegCaptureObserver, 'onCaptureAttempt'>): Promise<BrowserJpegCapture | undefined>;
export declare function encodeBrowserStreamFrame(frame: BrowserStreamFrame): Uint8Array;
export declare function encodeBrowserStreamJsonFrame(frame: BrowserStreamFrame): string;
export declare function decodeBrowserStreamFrame(value: ArrayBuffer | Uint8Array): BrowserStreamFrame;
export declare function dispatchBrowserInput(cdp: ManagedCdpSession, input: BrowserInput): Promise<void>;
export declare function browserStreamRequestAllowed(origin: string | undefined, host: string | undefined): boolean;
export declare function browserStreamCaptureScale(width: number, height: number, maxScale?: number): number;
//# sourceMappingURL=managed-browser-stream.d.ts.map