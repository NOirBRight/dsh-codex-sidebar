/** xterm constructor options shared with the Unicode 11 addon contract test. */
export declare const TERMINAL_GRAPHICS_FONT = "\"DCS Terminal Graphics\"";
export declare function terminalFontFamily(hostFont: string): string;
export declare function terminalOptions(fontFamily: string): {
    allowProposedApi: boolean;
    convertEol: boolean;
    cursorBlink: boolean;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    customGlyphs: boolean;
    rescaleOverlappingGlyphs: boolean;
    fontFamily: string;
};
//# sourceMappingURL=terminal-options.d.ts.map