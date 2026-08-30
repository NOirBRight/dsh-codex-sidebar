import { type BrowserClientMessage, type BrowserLayoutCommitMessage, type BrowserMediaIdentity, type BrowserMediaRouteMessage, type BrowserReadyMessage, type BrowserRtcCandidate, type BrowserRtcDescription, type BrowserStreamFrameV2 } from '../managed-browser-protocol.ts';
export declare function browserStreamShouldRun(pageVisible: boolean, intersecting: boolean, surfaceActive?: boolean): boolean;
/** Build the client answer without trusting structural identities to be runtime-exact. */
export declare function browserRtcAnswerMessage(identity: BrowserMediaIdentity, description: BrowserRtcDescription): BrowserClientMessage;
/** Buffers bounded Host ICE candidates only for the current owner and media generation. */
export declare class BrowserRtcCandidateBuffer {
    #private;
    /** Select the authoritative signaling identity and discard candidates from an older generation. */
    setIdentity(identity: BrowserMediaIdentity): void;
    /** Add one early candidate when it belongs to the selected identity and capacity remains. */
    add(identity: BrowserMediaIdentity, candidate: BrowserRtcCandidate | null): boolean;
    /** Remove all queued candidates for an exact offer in their original arrival order. */
    drain(identity: BrowserMediaIdentity): Array<BrowserRtcCandidate | null>;
    /** Discard the selected identity and every queued candidate. */
    clear(): void;
}
/** Delays disconnecting an already-active Browser stream while its surface is hidden. */
export declare class BrowserVisibilityGrace {
    #private;
    /**
     * @param initiallyVisible Whether the stream is active when visibility tracking starts.
     * @param onActiveChange Publishes connection eligibility after grace transitions.
     * @param now Monotonic-enough clock used to preserve the original hidden deadline.
     */
    constructor(initiallyVisible: boolean, onActiveChange: (active: boolean) => void, now?: () => number);
    /** Update the Host-authoritative hidden-surface grace duration. */
    setGraceMs(graceMs: number): void;
    /** Report whether both the document and Browser surface are visible. */
    setVisible(visible: boolean): void;
    /** Stop pending visibility work without changing connection state. */
    dispose(): void;
}
/** Touch taps must not focus the local hidden IME; it steals the remote click on Android. */
export declare function browserPointerShouldFocusIme(pointerType: string): boolean;
/** A completed touch tap may focus the hidden IME after its remote click is sent. */
export declare function browserTouchShouldFocusIme(moved: boolean): boolean;
export type BrowserPointerGesture = {
    revision: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
};
/** Buffer one desktop pointer gesture so Host dispatches press/release under one layout lease. */
export declare function browserPointerGestureMove(gesture: BrowserPointerGesture, x: number, y: number): {
    gesture: BrowserPointerGesture;
    moved: boolean;
};
/** Produce one atomic Host input for a completed buffered pointer gesture. */
export declare function browserPointerGestureEnd(gesture: BrowserPointerGesture, revision: number, x: number, y: number): {
    type: 'tap';
    x: number;
    y: number;
} | {
    type: 'drag';
    x: number;
    y: number;
    toX: number;
    toY: number;
} | undefined;
export type BrowserStreamSize = {
    width: number;
    height: number;
};
export type BrowserTouchGesture = {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
};
export declare function browserTouchGestureMove(current: BrowserTouchGesture, x: number, y: number, threshold?: number): {
    gesture: BrowserTouchGesture;
    moved: boolean;
    deltaX: number;
    deltaY: number;
};
/** Letterbox content into the container. Never stretch a mismatched JPEG. */
export declare function browserStreamFitSurface(container: BrowserStreamSize, content: BrowserStreamSize): BrowserStreamSize;
export declare const BROWSER_STREAM_HEADER_BYTES = 29;
export type DecodedBrowserFrame = BrowserStreamFrameV2;
export type BrowserStreamFrameEncoding = 'binary-v2' | 'json-base64-v2';
export type BrowserFrameIdentity = Pick<BrowserStreamFrameV2, 'sequence' | 'revision' | 'mediaGeneration'>;
export type BrowserMediaRetryState = {
    identity: BrowserMediaIdentity;
    nextRetryAt: number;
};
export type BrowserMediaPresentationRoute = 'direct-video' | 'low-bandwidth-fallback' | 'reconnecting' | 'unavailable';
export type BrowserMediaFailureReason = 'negotiation-timeout' | 'negotiation-error' | 'ready-missing' | 'ready-owner-mismatch' | 'receiver-sync-failed' | 'remote-description-failed' | 'candidate-failed' | 'answer-failed' | 'local-description-failed' | 'peer-failed' | 'host-fallback' | 'presentation-failed';
/** Assemble an exact client decline after direct video cannot present its first frame. */
export declare function browserMediaDeclineMessage(identity: BrowserMediaIdentity, reason?: Extract<BrowserClientMessage, {
    type: 'media-decline';
}>['reason']): Extract<BrowserClientMessage, {
    type: 'media-decline';
}>;
/** Decline only a local failure that still belongs to the current Host media identity. */
export declare function browserMediaDeclineForFailure(failed: BrowserMediaIdentity, current: BrowserMediaIdentity | undefined, reason: BrowserMediaFailureReason | undefined): Extract<BrowserClientMessage, {
    type: 'media-decline';
}> | undefined;
/** Report immediate surface visibility for the exact committed media identity. */
export declare function browserSurfaceVisibilityMessage(ready: Pick<BrowserReadyMessage, 'ownerId'> | null, layout: Pick<BrowserMediaIdentity, 'revision' | 'mediaGeneration'> | undefined, visible: boolean): Extract<BrowserClientMessage, {
    type: 'surface-visibility';
}> | undefined;
/** Project one Host route update without claiming direct video before a decoded frame is presented. */
export declare function browserMediaRouteFromHost(message: BrowserMediaRouteMessage, current: BrowserMediaPresentationRoute): BrowserMediaPresentationRoute;
/** Keep negotiation non-direct until the DOM presenter atomically commits the ready generation. */
export declare function browserMediaRouteFromReceiver(route: 'connecting' | 'webrtc-direct' | 'jpeg-fallback'): BrowserMediaPresentationRoute;
/** Rate-limit a receiver-less retry while allowing a new layout/media identity immediately. */
export declare function browserMediaRetryRequest(state: BrowserMediaRetryState | undefined, identity: BrowserMediaIdentity, trigger: 'explicit' | 'network-change' | 'tab-reactivate', cooldownMs: number, now: number): {
    state: BrowserMediaRetryState;
    message?: Extract<BrowserClientMessage, {
        type: 'media-retry';
    }>;
};
/** Declare the encodings and flow control understood by the Canvas client. */
export declare function browserStreamHello(webrtcVideo?: boolean): {
    type: 'hello';
    version: 2;
    frameEncodings: BrowserStreamFrameEncoding[];
    flowControl: ['frame-ack-v2'];
    media: {
        webrtcVideo: boolean;
    };
};
export declare function browserStreamReady(value: string): BrowserReadyMessage | undefined;
export declare function decodeBrowserLayoutCommit(value: string): BrowserLayoutCommitMessage | undefined;
export declare function decodeBrowserMediaRoute(value: string): BrowserMediaRouteMessage | undefined;
/**
 * Decode and paint one frame only while its originating connection remains current.
 * @param identity Host frame and layout identity to acknowledge.
 * @param decode Deferred frame decoder.
 * @param isConnectionCurrent Whether the originating socket generation is still active.
 * @param isFrameCurrent Whether the frame still belongs to the committed layout.
 * @param acceptFrame Atomically publishes the layout after a successful paint.
 * @param paint Synchronous Canvas paint operation.
 * @param dispose Decoded-frame resource disposer.
 * @param acknowledge ACK sender bound to the originating socket.
 * @returns A promise that settles after decode, optional paint, disposal, and optional ACK.
 */
export declare function paintBrowserFrameForConnection<T>(identity: BrowserFrameIdentity, decode: () => Promise<T>, isConnectionCurrent: () => boolean, isFrameCurrent: () => boolean, acceptFrame: () => boolean, paint: (decoded: T) => void, dispose: (decoded: T) => void, acknowledge: (identity: BrowserFrameIdentity) => void): Promise<void>;
export declare function decodeBrowserFrame(value: ArrayBuffer): DecodedBrowserFrame;
export declare function browserBinaryFrameIdentity(value: ArrayBuffer): BrowserFrameIdentity | undefined;
/** APP WebViews may deliver JPEG frames as ArrayBuffer, typed arrays, Blob, or binary strings. */
export declare function browserStreamFrameBuffer(data: unknown): ArrayBuffer | undefined;
export declare function browserStreamTextMessage(data: unknown): string | undefined;
export type BrowserOutlineNode = {
    ref: string;
    role: string;
    name: string;
    selector: string;
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
};
export type BrowserOutline = {
    documentId: string;
    nodes: BrowserOutlineNode[];
};
export declare function decodeBrowserOutline(value: string): BrowserOutline | undefined;
export type BrowserAnnotationRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type BrowserEvidenceSelectionPoint = {
    revision: number;
    x: number;
    y: number;
};
/** Return one evidence rectangle only when both pointer events used the same presented layout. */
export declare function browserEvidenceSelectionRect(start: BrowserEvidenceSelectionPoint, end: BrowserEvidenceSelectionPoint): BrowserAnnotationRect | undefined;
export type BrowserTrackedRect = {
    documentId: string;
    selector: string;
    rect: BrowserAnnotationRect | null;
};
export declare function decodeBrowserTrackedRect(value: string): BrowserTrackedRect | undefined;
export declare function updateBrowserSelectedRect(current: BrowserAnnotationRect | null, update: {
    type: 'wheel';
} | {
    type: 'tracked';
    rect: BrowserAnnotationRect | null;
}): BrowserAnnotationRect | null;
export declare function browserAnnotationHighlightRects(selected: BrowserAnnotationRect | null, hovered: BrowserAnnotationRect | null): {
    selected: BrowserAnnotationRect | null;
    hovered: BrowserAnnotationRect | null;
};
export declare function browserSelectedRectForOutline(selector: string, nodes: readonly BrowserOutlineNode[]): BrowserAnnotationRect | null;
export declare function browserAnnotationNodeAt(nodes: readonly BrowserOutlineNode[], point: {
    x: number;
    y: number;
}): BrowserOutlineNode | undefined;
export declare function decodeBrowserJpegJson(value: string): DecodedBrowserFrame | undefined;
export declare function browserJsonFrameIdentity(value: string): BrowserFrameIdentity | undefined;
export declare function browserStreamSignalsReady(value: unknown): boolean;
export declare function browserWebSocketUrl(path: string, locationLike?: Pick<Location, 'protocol' | 'host'>): string;
export type StreamInput = {
    type: string;
    [key: string]: unknown;
};
export declare function createBrowserInputCoalescer(send: (input: StreamInput) => void, schedule?: (flush: () => void) => number, cancelSchedule?: (id: number) => void): {
    push(input: StreamInput): void;
    flush(): void;
    cancel(): void;
};
//# sourceMappingURL=managed-browser-stream.d.ts.map