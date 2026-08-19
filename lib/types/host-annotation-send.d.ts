/** Stage 批注 evidence and splice it into the claimed user message at pre-step. */
import { type AnnotationMarkView } from './annotation.ts';
import type { Annotation, BrowserEvidence } from './session.ts';
export type ImageAttachmentRef = {
    attachmentId: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    bytes: number;
    width: number;
    height: number;
    name?: string;
};
export declare const MAX_ANNOTATION_IMAGES = 20;
export declare const STAGE_TTL_MS = 30000;
export type TextBlock = {
    type: 'text';
    text: string;
};
export type ImageBlock = {
    type: 'image';
    attachment: ImageAttachmentRef;
};
export type UserContentBlock = TextBlock | ImageBlock;
export type EnrichableMessage = {
    id: string;
    role: 'user';
    content: readonly UserContentBlock[];
    source: unknown;
};
export type StagedAnnotationBatch = {
    sessionId: string;
    attachments: Annotation[];
    marks: AnnotationMarkView[];
    images: Array<{
        evidenceId: string;
        attachment: ImageAttachmentRef;
    }>;
    evidenceText: string;
    expiresAt: number;
};
export type AnnotationSendPorts = {
    now?: () => number;
    ttlMs?: number;
    readFile?: (path: string) => string | undefined;
    saveImage?: (input: {
        data: Uint8Array;
        mediaType: 'image/jpeg';
        name?: string;
    }) => Promise<ImageAttachmentRef>;
    readEvidence?: (sessionId: string, evidence: BrowserEvidence) => Promise<{
        mediaType: 'image/jpeg';
        data: string;
    }>;
    agentLive?: (sessionId: string) => boolean;
};
export declare class AnnotationSendStore {
    #private;
    constructor(opts?: {
        now?: () => number;
        ttlMs?: number;
    });
    stage(batch: Omit<StagedAnnotationBatch, 'expiresAt'>): StagedAnnotationBatch;
    unstage(sessionId: string): void;
    bindInserted(sessionId: string, message: {
        id: string;
        source: unknown;
    }): void;
    takeForMessage(messageId: string): StagedAnnotationBatch | undefined;
}
export declare function isUserSource(source: unknown): boolean;
export declare function snippetsFor(attachments: readonly Annotation[], read?: (path: string) => string | undefined): Record<string, string>;
export declare function enrichUserMessage(message: EnrichableMessage, batch: StagedAnnotationBatch): EnrichableMessage;
export declare function applyAnnotationEnrichment(messages: readonly EnrichableMessage[], store: AnnotationSendStore): EnrichableMessage[];
export declare function buildStagedBatch(sessionId: string, attachments: readonly Annotation[], ports: AnnotationSendPorts): Promise<Omit<StagedAnnotationBatch, 'expiresAt'>>;
export declare function decodeAnnotationList(value: unknown): Annotation[] | undefined;
export type AnnotationSendHost = {
    on(event: string, listener: (...args: never[]) => unknown): () => void;
};
export declare function installAnnotationSend(ctx: AnnotationSendHost, store: AnnotationSendStore): () => void;
//# sourceMappingURL=host-annotation-send.d.ts.map