/** Versioned wire messages shared by the managed Browser Host and client. */
export declare const MANAGED_BROWSER_PROTOCOL_VERSION = 2;
/** Default delay before a hidden managed Browser surface releases its control connection. */
export declare const MANAGED_BROWSER_MEDIA_HIDE_GRACE_MS = 15000;
/** Maximum ICE candidates retained or forwarded for one media attempt in either direction. */
export declare const MANAGED_BROWSER_MAX_RTC_CANDIDATES = 64;
export declare const BROWSER_STREAM_V2_HEADER_BYTES = 29;
export type BrowserLayoutMode = 'fit' | 'phone' | 'tablet' | 'laptop';
export type BrowserSize = {
    width: number;
    height: number;
};
export type BrowserLayout = {
    revision: number;
    mode: BrowserLayoutMode;
    viewport: BrowserSize;
    mediaGeneration: number;
};
export type BrowserMediaIdentity = {
    ownerId: string;
    revision: number;
    mediaGeneration: number;
};
export type BrowserRtcDescription = {
    type: 'offer' | 'answer';
    sdp: string;
};
export type BrowserRtcCandidate = {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
};
export type BrowserInput = {
    type: 'wheel';
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    selector?: string;
} | {
    type: 'tap';
    x: number;
    y: number;
} | {
    type: 'drag';
    x: number;
    y: number;
    toX: number;
    toY: number;
} | {
    type: 'move';
    x: number;
    y: number;
} | {
    type: 'keyDown' | 'keyUp';
    key: string;
    code: string;
    modifiers?: number;
} | {
    type: 'text';
    text: string;
};
export type BrowserClientMessage = {
    type: 'hello';
    version: 2;
    frameEncodings: Array<'binary-v2' | 'json-base64-v2'>;
    flowControl: ['frame-ack-v2'];
    media: {
        webrtcVideo: boolean;
    };
} | {
    type: 'layout-propose';
    proposalSequence: number;
    mode: BrowserLayoutMode;
    viewport: BrowserSize;
} | {
    type: 'input';
    revision: number;
    input: BrowserInput;
} | {
    type: 'frame-ack';
    sequence: number;
    revision: number;
    mediaGeneration: number;
} | ({
    type: 'rtc-answer';
    description: BrowserRtcDescription;
} & BrowserMediaIdentity) | ({
    type: 'rtc-candidate';
    candidate: BrowserRtcCandidate | null;
} & BrowserMediaIdentity) | ({
    type: 'media-retry';
    trigger: 'explicit' | 'network-change' | 'tab-reactivate';
} & BrowserMediaIdentity) | ({
    type: 'media-decline';
    reason: 'presentation-failed';
} & BrowserMediaIdentity) | ({
    type: 'surface-visibility';
    visible: boolean;
} & BrowserMediaIdentity) | {
    type: 'outline';
};
export type BrowserHostMessage = BrowserReadyMessage | ({
    type: 'rtc-offer';
    description: BrowserRtcDescription;
} & BrowserMediaIdentity) | ({
    type: 'rtc-candidate';
    candidate: BrowserRtcCandidate | null;
} & BrowserMediaIdentity);
export type BrowserReadyMessage = {
    type: 'ready';
    version: 2;
    frameEncoding: 'binary-v2' | 'json-base64-v2';
    flowControl: 'frame-ack-v2';
    fallback: {
        maxRawBytes: number;
    };
    ownerId: string;
    media: {
        preferredRoute: 'webrtc-direct' | 'jpeg-fallback';
        stunOnly: true;
        stunUrls: string[];
        negotiationTimeoutMs: number;
        retryCooldownMs: number;
        frameRate: number;
        maxBitrate: number;
        idleTimeoutMs: number;
        hideGraceMs: number;
    };
    layoutPolicy: {
        minViewport: BrowserSize;
        maxViewport: BrowserSize;
        settleMs: number;
        hysteresisPx: number;
    };
};
export type BrowserLayoutCommitMessage = {
    type: 'layout-commit';
    layout: BrowserLayout;
};
export type BrowserMediaRouteMessage = {
    type: 'media-route';
    route: 'jpeg-fallback' | 'webrtc-direct' | 'unavailable';
    status: 'active' | 'degraded' | 'reconnecting';
    reason?: string;
};
export type BrowserStreamFrameV2 = {
    version: 2;
    sequence: number;
    sentAt: number;
    revision: number;
    mediaGeneration: number;
    viewport: BrowserSize;
    encodedSize: BrowserSize;
    jpeg: Uint8Array;
};
/** Decode one untrusted control message from the Browser WebSocket. */
export declare function decodeBrowserClientMessage(raw: string): BrowserClientMessage | undefined;
/** Decode one untrusted Host WebRTC signaling message. */
export declare function decodeBrowserHostMessage(raw: string): BrowserHostMessage | undefined;
/** Encode one binary JPEG frame with layout and media identity. */
export declare function encodeBrowserStreamFrameV2(frame: BrowserStreamFrameV2): Uint8Array;
/** Decode one binary v2 JPEG frame. */
export declare function decodeBrowserStreamFrameV2(value: ArrayBuffer | Uint8Array): BrowserStreamFrameV2;
/** Encode a tunneled JSON v2 JPEG frame. */
export declare function encodeBrowserStreamJsonFrameV2(frame: BrowserStreamFrameV2): string;
/** Decode one tunneled JSON v2 JPEG frame. */
export declare function decodeBrowserStreamJsonFrameV2(raw: string): BrowserStreamFrameV2 | undefined;
//# sourceMappingURL=managed-browser-protocol.d.ts.map