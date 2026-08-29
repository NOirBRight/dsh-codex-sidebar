/** Split a logged user message into human text vs hidden evidence. */
/** Invisible draft content used only to make an annotation-only Alpha composer submit-ready. */
export declare const ANNOTATION_DRAFT_SENTINEL = "\u200B";
/** Remove the plugin-owned submit sentinel before text reaches transcript or model views. */
export declare function stripAnnotationDraftSentinel(draft: string): string;
export type MessageImageRef = {
    attachmentId: string;
};
export type UserTextPart = {
    kind: 'text';
    text: string;
} | {
    kind: 'ref';
    text: string;
};
export declare function projectUserText(text: string): UserTextPart[];
export declare function firstTextBlock(content: readonly unknown[]): string;
export declare function contentImages(content: readonly unknown[]): MessageImageRef[];
//# sourceMappingURL=annotation-message.d.ts.map