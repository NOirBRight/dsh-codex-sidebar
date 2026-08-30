/** Browser-client WebRTC receiver state, independent of React and DOM presentation. */
import { type BrowserMediaIdentity, type BrowserRtcCandidate, type BrowserRtcDescription } from './managed-browser-protocol.ts';
export type { BrowserRtcCandidate, BrowserRtcDescription } from './managed-browser-protocol.ts';
export type BrowserMediaClientIdentity = Readonly<BrowserMediaIdentity>;
export type BrowserMediaReceiverTrack = {
    readonly kind: string;
    stop(): void;
};
export type BrowserMediaReceiverPeerEvents = {
    onCandidate(candidate: BrowserRtcCandidate | null): void;
    onConnectionState(state: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'): void;
    onTrack(track: BrowserMediaReceiverTrack): void;
};
/** The receiver never receives media-device access; it can only consume a remote video track. */
export type BrowserMediaReceiverPeer = {
    setRemoteDescription(description: BrowserRtcDescription): Promise<void>;
    createAnswer(): Promise<BrowserRtcDescription>;
    setLocalDescription(description: BrowserRtcDescription): Promise<void>;
    addIceCandidate(candidate: BrowserRtcCandidate | null): Promise<void>;
    close(): void;
};
export type BrowserMediaRetryTrigger = 'explicit' | 'network-change' | 'tab-reactivate';
export type BrowserMediaFallbackReason = 'negotiation-timeout' | 'negotiation-error' | 'remote-description-failed' | 'candidate-failed' | 'answer-failed' | 'local-description-failed' | 'peer-failed' | 'host-fallback' | 'presentation-failed';
export type BrowserMediaReceiverEvent = BrowserMediaClientIdentity & {
    event: {
        type: 'candidate';
        candidate: BrowserRtcCandidate | null;
    } | {
        type: 'video-track';
        track: BrowserMediaReceiverTrack;
    } | {
        type: 'route';
        route: 'connecting' | 'webrtc-direct' | 'jpeg-fallback';
        reason?: BrowserMediaFallbackReason;
    } | {
        type: 'generation-ready';
        track: BrowserMediaReceiverTrack;
    } | {
        type: 'retry-request';
        trigger: BrowserMediaRetryTrigger;
    };
};
export type ManagedBrowserWebRtcReceiverOptions = {
    identity: BrowserMediaClientIdentity;
    peerFactory: (events: BrowserMediaReceiverPeerEvents) => BrowserMediaReceiverPeer;
    negotiationTimeoutMs: number;
    retryCooldownMs: number;
    onEvent?: (event: BrowserMediaReceiverEvent) => void;
    now?: () => number;
    schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};
/** One authenticated owner/layout/media generation and its replaceable receive attempt. */
export declare class ManagedBrowserWebRtcReceiver {
    #private;
    readonly identity: BrowserMediaClientIdentity;
    constructor(opts: ManagedBrowserWebRtcReceiverOptions);
    /** Replace the current receive attempt and create an SDP answer for an exact current identity. */
    acceptOffer(identity: BrowserMediaClientIdentity, offer: BrowserRtcDescription): Promise<BrowserRtcDescription | undefined>;
    /** Apply or queue one candidate only for the exact active identity. */
    addCandidate(identity: BrowserMediaClientIdentity, candidate: BrowserRtcCandidate | null): Promise<boolean>;
    /** Confirm that the current video track has presented its first decoded frame. */
    markFrameReady(identity: BrowserMediaClientIdentity, track: BrowserMediaReceiverTrack): boolean;
    /** Request a fresh Host offer after the fallback cooldown. */
    requestRetry(trigger: BrowserMediaRetryTrigger): boolean;
    /** Release the current direct-video attempt and enter cooldown-backed JPEG fallback. */
    useFallback(reason: 'host-fallback' | 'presentation-failed'): boolean;
    /** Close the exact current peer and track and cancel all future callbacks. */
    dispose(): void;
}
//# sourceMappingURL=managed-browser-webrtc-client.d.ts.map