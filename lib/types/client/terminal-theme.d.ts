/** Map DSH theme tokens onto an xterm ITheme. No hex — computed vars only. */
export type TerminalXtermTheme = {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
};
/** CSS custom properties defined on .dcs-term, each aliasing a DSH token. */
export declare const TERMINAL_THEME_VARS: {
    readonly background: "--dcs-term-bg";
    readonly foreground: "--dcs-term-fg";
    readonly cursor: "--dcs-term-cursor";
    readonly cursorAccent: "--dcs-term-cursor-accent";
    readonly selectionBackground: "--dcs-term-selection";
    readonly black: "--dcs-term-black";
    readonly red: "--dcs-term-red";
    readonly green: "--dcs-term-green";
    readonly yellow: "--dcs-term-yellow";
    readonly blue: "--dcs-term-blue";
    readonly magenta: "--dcs-term-magenta";
    readonly cyan: "--dcs-term-cyan";
    readonly white: "--dcs-term-white";
    readonly brightBlack: "--dcs-term-bright-black";
    readonly brightRed: "--dcs-term-bright-red";
    readonly brightGreen: "--dcs-term-bright-green";
    readonly brightYellow: "--dcs-term-bright-yellow";
    readonly brightBlue: "--dcs-term-bright-blue";
    readonly brightMagenta: "--dcs-term-bright-magenta";
    readonly brightCyan: "--dcs-term-bright-cyan";
    readonly brightWhite: "--dcs-term-bright-white";
};
export declare function readTerminalTheme(el: Element, readVar?: (name: string) => string): TerminalXtermTheme;
export declare function watchTerminalTheme(el: Element, apply: (theme: TerminalXtermTheme) => void): () => void;
//# sourceMappingURL=terminal-theme.d.ts.map