import type { BrowserMediaPresentationRoute } from './managed-browser-stream.ts';
import { type ManagedBrowserLayoutCommit, type ManagedBrowserLayoutSnapshot, type ManagedBrowserSize } from './managed-browser-layout.ts';
import type { BrowserVideoPresentationSnapshot } from './managed-browser-webrtc-dom.ts';
import type { BrowserMediaIdentity } from '../managed-browser-protocol.ts';
type AttributeTarget = {
    setAttribute(name: string, value: string): void;
};
/** Browser control-connection state reported by presentation diagnostics. */
export type BrowserPresentationConnection = 'connecting' | 'connected' | 'disconnected';
/** Exact visible presenter, including the identity accepted by its own media path. */
export type BrowserPresentationSource = Extract<BrowserVideoPresentationSnapshot, {
    presenter: 'video';
}> | {
    presenter: 'canvas';
    identity: BrowserMediaIdentity | null;
} | {
    presenter: 'none';
};
/** Complete input used for one atomic Browser presentation observation. */
export type BrowserPresentationState = {
    connection: BrowserPresentationConnection;
    ownerId: string | null;
    layout: ManagedBrowserLayoutSnapshot | null;
    mediaRoute: BrowserMediaPresentationRoute;
    source: BrowserPresentationSource;
};
/** Non-sensitive presentation metadata exposed on the Browser surface. */
export type BrowserPresentationObservation = {
    version: 1;
    connection: BrowserPresentationConnection;
    committed: ManagedBrowserLayoutCommit | null;
    presented: ManagedBrowserLayoutCommit | null;
    encodedSize: ManagedBrowserSize | null;
    surface: ManagedBrowserSize | null;
    mediaRoute: BrowserMediaPresentationRoute;
    presenter: {
        kind: 'none';
    } | {
        kind: 'canvas';
        identity: BrowserMediaIdentity | null;
    } | {
        kind: 'video';
        slot: 0 | 1;
        identity: BrowserMediaIdentity;
        intrinsicSize: ManagedBrowserSize | null;
    };
};
/** Publish one complete non-sensitive presentation state with a single DOM mutation; defer direct route diagnostics until its current video is presented. */
export declare function publishBrowserPresentation(target: AttributeTarget | undefined, state: BrowserPresentationState): BrowserPresentationObservation | undefined;
export {};
//# sourceMappingURL=managed-browser-observability.d.ts.map