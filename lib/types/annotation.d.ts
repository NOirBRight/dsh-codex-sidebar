/** Build and label stacked 批注 without dumping page innerText. */
import type { Annotation, AnnotationRect, AnnotationTextRange, BrowserEvidence } from './session.ts';
export declare function noteBody(draft: string): string;
export declare function parsePathLine(mark: string): {
    path: string;
    line?: number;
};
export declare function fileCaption(mark: string): string;
export declare function hydrateAnnotation(item: {
    id: string;
    text?: string;
    from?: string;
    source?: Annotation['source'];
    selector?: string;
    path?: string;
    line?: number;
    rect?: AnnotationRect;
    selection?: AnnotationTextRange;
    url?: string;
    evidence?: BrowserEvidence;
}): Annotation;
export declare function fromFileMark(id: string, draft: string, mark: string, rect?: AnnotationRect, selection?: AnnotationTextRange): Annotation;
export declare function fromReviewMark(id: string, draft: string, mark: string): Annotation;
export declare function fromBrowserPending(id: string, draft: string, pending: {
    pendingMark: string;
    pendingSelector: string | null;
    pendingRect: AnnotationRect | null;
    url: string;
    evidence?: BrowserEvidence;
}): Annotation;
export type AnnotationMarkView = {
    id: string;
    from: string;
    source: Annotation['source'];
    selector?: string;
    path?: string;
    line?: number;
    url?: string;
    rect?: AnnotationRect;
    selection?: AnnotationTextRange;
    evidenceId?: string;
};
export declare const SNIPPET_RADIUS = 10;
export declare const SNIPPET_MAX_CHARS = 2000;
export declare function toMarkView(item: Annotation): AnnotationMarkView;
export declare function visibleAnnotations(snapshot: {
    attachments: readonly Annotation[];
    deliveredMarks?: readonly Annotation[];
}): Annotation[];
export declare function annotationMarksFromSource(source: unknown): AnnotationMarkView[] | undefined;
export declare function decodeMarkView(value: unknown): AnnotationMarkView | undefined;
export declare function fileSnippet(source: string, line?: number, radius?: number, maxChars?: number): string;
//# sourceMappingURL=annotation.d.ts.map