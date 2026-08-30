import type { BrowserMediaReceiverPeer, BrowserMediaReceiverPeerEvents, BrowserMediaReceiverTrack } from '../managed-browser-webrtc-client.ts';
import type { BrowserMediaIdentity } from '../managed-browser-protocol.ts';
type PeerScope = {
    RTCPeerConnection?: unknown;
};
/** Report whether the current DOM can construct a receive-only WebRTC peer. */
export declare function browserWebRtcVideoAvailable(scope?: PeerScope): boolean;
/** Create the receive-only browser peer used by the transport-neutral receiver. */
export declare function createBrowserDomPeer(events: BrowserMediaReceiverPeerEvents): BrowserMediaReceiverPeer;
type VideoLike = {
    muted: boolean;
    autoplay: boolean;
    playsInline: boolean;
    srcObject: unknown;
    readyState: number;
    videoWidth: number;
    videoHeight: number;
    play(): Promise<void>;
    pause(): void;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    requestVideoFrameCallback?(callback: () => void): number;
    cancelVideoFrameCallback?(id: number): void;
};
type PresentedVideoSize = {
    width: number;
    height: number;
};
type PresentationVideo = VideoLike & {
    dataset: {
        dcsPresenter?: string;
    };
};
type PresentationCanvas = {
    style: {
        opacity: string;
    };
};
type BrowserVideoStage = {
    readonly slot: 0 | 1;
    readonly identity: BrowserMediaIdentity;
    readonly surface: BrowserVideoSurface;
};
/** Exact DOM presenter currently visible on the managed Browser surface. */
export type BrowserVideoPresentationSnapshot = {
    presenter: 'canvas';
} | {
    presenter: 'video';
    slot: 0 | 1;
    identity: BrowserMediaIdentity;
    intrinsicSize: PresentedVideoSize | null;
};
/** Settle every video presentation outcome only while its media identity remains current. */
export declare function handleBrowserVideoPresentation(presentation: Promise<PresentedVideoSize | undefined>, isCurrent: () => boolean, onReady: (size: PresentedVideoSize) => void, onUnavailable: () => void): Promise<void>;
/** Double-buffer video DOM attachment and preserve the last presented surface until commit. */
export declare class BrowserVideoPresentationSwitch {
    #private;
    constructor(videos: readonly [PresentationVideo, PresentationVideo], canvas: PresentationCanvas, createStream?: (tracks: BrowserMediaReceiverTrack[]) => unknown);
    /** Attach an exact media identity to the hidden slot without changing the visible presentation. */
    stage(identity: BrowserMediaIdentity, timeoutMs: number): BrowserVideoStage;
    /** Reveal one ready stage and release the previous video only after the reveal. */
    commit(stage: BrowserVideoStage): boolean;
    /** Drop only the matching staged attachment and leave the last presentation untouched. */
    discard(stage: BrowserVideoStage): boolean;
    /** Drop the current staged attachment, if any. */
    discardPending(): void;
    /** Report whether a stage can still commit without replacing a newer candidate. */
    canCommit(stage: BrowserVideoStage): boolean;
    /** Return the single DOM source currently revealed to the Browser surface. */
    snapshot(): BrowserVideoPresentationSnapshot;
    /** Reveal an already-painted fallback canvas before releasing the previous video. */
    showCanvas(): void;
    /** Release both visible and staged video attachments. */
    clear(): void;
}
/** Owns one video element attachment and resolves only after its first decoded frame. */
export declare class BrowserVideoSurface {
    #private;
    constructor(video: VideoLike, createStream?: (tracks: BrowserMediaReceiverTrack[]) => unknown, timeoutMs?: number);
    present(track: BrowserMediaReceiverTrack): Promise<PresentedVideoSize | undefined>;
    clear(): void;
}
export {};
//# sourceMappingURL=managed-browser-webrtc-dom.d.ts.map