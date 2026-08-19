/** Split a logged user message into human text vs hidden evidence. */
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