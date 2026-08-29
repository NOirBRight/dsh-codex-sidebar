/** Live SidebarSession store + host RPC + 主会话 prompt / path takeover. */
import type { ClientContext } from './shim.js';
import type { Intent, SidebarSnapshot } from '../session.ts';
import type { BrowserLayout } from '../managed-browser-protocol.ts';
export type SidebarStore = {
    bySession: Record<string, SidebarSnapshot>;
};
export type BrowserCaptureReply = {
    captureId: string;
    documentId: string;
    layoutRevision: number;
    mediaGeneration: number;
    url: string;
    title: string;
    width: number;
    height: number;
    nodes: Array<{
        ref: string;
        role: string;
        name: string;
        selector: string;
        rect?: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
    }>;
};
export declare class SidebarController {
    #private;
    constructor(ctx: ClientContext);
    readonly getSnapshot: () => SidebarStore;
    readonly subscribe: (listener: () => void) => (() => void);
    /** Release session event subscriptions owned by this controller. */
    dispose(): void;
    snap(sessionId: string): SidebarSnapshot | undefined;
    browserCapture(sessionId: string, tabId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserCaptureReply | undefined>;
    browserStreamTicket(sessionId: string, tabId: string): Promise<{
        path: string;
        expiresAt: number;
    } | undefined>;
    pullTerminal(sessionId: string, tabId: string, since: number): Promise<{
        seq: number;
        chunk: string;
    } | undefined>;
    refresh(sessionId: string, signal?: AbortSignal): Promise<SidebarSnapshot | undefined>;
    readFilePreview(sessionId: string, path: string): Promise<string | undefined>;
    dispatch(sessionId: string, intent: Intent, applyEffects?: boolean): Promise<SidebarSnapshot | undefined>;
    installPathTakeover(): void;
    /**
     * AppFrame columns are pinned by the overlay ColumnPin. Do not closeDetails
     * while the 侧栏 is open — that would collapse the third track.
     */
    readonly hideHostDetails: () => void;
    /** Open this client's details track. Other surfaces keep their own chrome. */
    reveal(sessionId: string): void;
    /** Close this client's details track without collapsing other surfaces. */
    hide(sessionId: string): void;
    syncTrack(collapsed: boolean | undefined): void;
}
//# sourceMappingURL=controller.d.ts.map