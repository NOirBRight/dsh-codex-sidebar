/** Temporary Browser captures and draft screenshot evidence sidecars. */
import type { DriveNode } from './browser-drive.ts';
import type { ManagedBrowserRuntime, ManagedTabKey } from './managed-browser-runtime.ts';
import type { BrowserEvidence } from './session.ts';
export type BrowserCaptureMetadata = {
    captureId: string;
    documentId: string;
    url: string;
    title: string;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
    nodes: DriveNode[];
};
export declare class ManagedBrowserEvidenceStore {
    #private;
    readonly root: string;
    constructor(runtime: ManagedBrowserRuntime, opts?: {
        root?: string;
        now?: () => number;
    });
    capture(tab: ManagedTabKey): Promise<BrowserCaptureMetadata>;
    commit(sessionId: string, captureId: string): Promise<BrowserEvidence>;
    read(sessionId: string, evidence: BrowserEvidence): Promise<{
        mediaType: 'image/jpeg';
        data: string;
    }>;
    discard(captureId: string): void;
    remove(evidence: BrowserEvidence): Promise<void>;
}
//# sourceMappingURL=managed-browser-evidence.d.ts.map