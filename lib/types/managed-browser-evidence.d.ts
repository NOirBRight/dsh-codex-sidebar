/** Temporary Browser captures and draft screenshot evidence sidecars. */
import type { DriveNode } from './browser-drive.ts';
import type { ManagedBrowserRuntime, ManagedTabKey } from './managed-browser-runtime.ts';
import type { BrowserLayout } from './managed-browser-protocol.ts';
import type { BrowserEvidence } from './session.ts';
export declare const MANAGED_BROWSER_EVIDENCE_CHUNK_BYTES: number;
export type BrowserEvidenceChunk = {
    mediaType: 'image/jpeg';
    data: string;
    offset: number;
    nextOffset: number;
    totalBytes: number;
    done: boolean;
};
export type BrowserCaptureMetadata = {
    captureId: string;
    documentId: string;
    layoutRevision: number;
    mediaGeneration: number;
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
    capture(tab: ManagedTabKey, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserCaptureMetadata>;
    commit(sessionId: string, captureId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserEvidence>;
    read(sessionId: string, evidence: BrowserEvidence): Promise<{
        mediaType: 'image/jpeg';
        data: string;
    }>;
    /** Read one bounded evidence segment for transport through the Mobile tunnel. */
    readChunk(sessionId: string, evidence: BrowserEvidence, offset: number): Promise<BrowserEvidenceChunk>;
    discard(captureId: string): void;
    remove(evidence: BrowserEvidence): Promise<void>;
}
//# sourceMappingURL=managed-browser-evidence.d.ts.map