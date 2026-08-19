/** Read-only Files preview: Markdown blocks and code tokens. No HTML in, no HTML out. */
export type TokenKind = 'kw' | 'str' | 'com' | 'num' | 'punc' | 'text';
export type Token = {
    kind: TokenKind;
    text: string;
};
export type Inline = {
    kind: 'text';
    text: string;
} | {
    kind: 'code';
    text: string;
} | {
    kind: 'strong';
    text: string;
} | {
    kind: 'em';
    text: string;
} | {
    kind: 'link';
    text: string;
    href: string;
};
export type MdBlock = {
    type: 'h';
    level: 1 | 2 | 3;
    line: number;
    inlines: Inline[];
} | {
    type: 'p';
    line: number;
    inlines: Inline[];
} | {
    type: 'ul';
    line: number;
    items: Inline[][];
} | {
    type: 'ol';
    line: number;
    items: Inline[][];
} | {
    type: 'quote';
    line: number;
    inlines: Inline[];
} | {
    type: 'code';
    line: number;
    lang: string;
    text: string;
} | {
    type: 'table';
    line: number;
    headers: Inline[][];
    rows: Inline[][][];
} | {
    type: 'hr';
    line: number;
};
export type PreviewKind = 'markdown' | 'code' | 'text';
export declare function extOf(path: string): string;
export declare function previewKind(path: string): PreviewKind;
export declare function langOf(path: string): string;
export declare function highlightSource(path: string, source: string): Token[][];
export declare function parseMarkdown(source: string): MdBlock[];
export declare function parseInlines(input: string): Inline[];
//# sourceMappingURL=preview.d.ts.map