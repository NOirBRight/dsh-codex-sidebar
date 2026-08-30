/** Chromium-owned Canvas/WebRTC encoder isolated from the Browser control protocol. */
import type { BrowserRtcCandidate, BrowserRtcDescription } from './managed-browser-protocol.ts';
export type { BrowserRtcCandidate, BrowserRtcDescription } from './managed-browser-protocol.ts';
export type BrowserMediaIdentity = {
    readonly ownerId: string;
    readonly generation: number;
};
export type BrowserMediaFrame = {
    sequence: number;
    width: number;
    height: number;
    jpeg: Uint8Array;
};
export type BrowserPeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type BrowserMediaPageSignal = {
    type: 'candidate';
    candidate: BrowserRtcCandidate | null;
} | {
    type: 'connection-state';
    state: BrowserPeerConnectionState;
};
export type BrowserMediaSignal = BrowserMediaIdentity & {
    signal: BrowserMediaPageSignal | {
        type: 'frame-painted';
        sequence: number;
        width: number;
        height: number;
    } | {
        type: 'encoder-error';
        message: string;
    };
};
/** The only owned-Page operations required by the media encoder. Binding sources identify this adapter as `source.page`. */
export type BrowserMediaPage = {
    exposeBinding(name: string, callback: (source: unknown, payload: unknown) => void): Promise<void>;
    evaluateFunction<R>(source: string, argument: unknown): Promise<R>;
    close(): Promise<void>;
};
export type ManagedBrowserWebRtcEncoderOptions = {
    identity: BrowserMediaIdentity;
    pageFactory: () => Promise<BrowserMediaPage>;
    stunUrls?: readonly string[];
    width: number;
    height: number;
    /** Maximum video frames encoded per second. */
    frameRate?: number;
    /** Maximum outbound video bitrate in bits per second. */
    maxBitrate?: number;
    onSignal?: (signal: BrowserMediaSignal) => void;
};
export declare const MANAGED_BROWSER_DIRECT_VIDEO_FRAME_RATE = 20;
export declare const MANAGED_BROWSER_DIRECT_VIDEO_MAX_BITRATE = 8000000;
/** STUN-only default so GUI Chrome and the encoder Page can form srflx pairs in addition to host ICE. */
export declare const MANAGED_BROWSER_DEFAULT_STUN_URLS: readonly ["stun:stun.l.google.com:19302"];
/** Validate and copy STUN-only ICE server URLs. */
export declare function validateBrowserStunUrls(urls: readonly string[]): string[];
/** One immutable Browser owner/generation and its Chromium media Page. */
export declare class ManagedBrowserWebRtcEncoder {
    #private;
    readonly identity: BrowserMediaIdentity;
    constructor(opts: ManagedBrowserWebRtcEncoderOptions);
    /** Create the owned Page and return its SDP offer. */
    start(): Promise<BrowserRtcDescription>;
    /** Apply the authenticated client's SDP answer. */
    acceptAnswer(description: BrowserRtcDescription): Promise<void>;
    /** Add one authenticated client ICE candidate, including the end-of-candidates marker. */
    addCandidate(candidate: BrowserRtcCandidate | null): Promise<void>;
    /** Retain the latest JPEG until the peer can accept one serialized Canvas paint. */
    submit(frame: BrowserMediaFrame): boolean;
    /** Stop the track and peer, close the owned Page, and ignore later callbacks. */
    dispose(): Promise<void>;
}
//# sourceMappingURL=managed-browser-webrtc.d.ts.map