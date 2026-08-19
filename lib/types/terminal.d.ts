/** Terminal 工具 slice: the human's pty, not the 舵主's command tool. */
import type { Effect } from './session.ts';
export type TerminalSize = {
    cols: number;
    rows: number;
};
export type TerminalIntent = {
    type: 'terminal-open';
    tabId: string;
    cols?: number;
    rows?: number;
} | {
    type: 'terminal-write';
    tabId: string;
    bytes: string;
} | {
    type: 'terminal-refresh';
    tabId: string;
    since?: number;
} | {
    type: 'terminal-resize';
    tabId: string;
    cols: number;
    rows: number;
} | {
    type: 'terminal-destroy';
    tabId: string;
};
export type TerminalPull = {
    seq: number;
    chunk: string;
};
export type TerminalPort = {
    cwd(): string;
    create(tabId: string, cwd: string, token?: string, size?: TerminalSize): string;
    write(tabId: string, bytes: string): void;
    destroy(tabId: string): void;
    read(tabId: string): string;
    resize?(tabId: string, cols: number, rows: number): void;
    pull?(tabId: string, since: number): TerminalPull;
};
export type TerminalPty = {
    cwd: string;
    output: string;
    token: string;
    seq: number;
    chunk: string;
};
export type TerminalState = {
    byTab: Record<string, TerminalPty>;
};
/** Last N bytes kept in the live pty ring. TUI redraw storms must not freeze the host. */
export declare const TERMINAL_OUTPUT_CAP = 256000;
export declare function clipTerminalOutput(output: string): string;
export declare function emptyTerminal(): TerminalState;
export declare function projectTerminal(state: TerminalState): TerminalState;
export declare function reduceTerminal(state: TerminalState, intent: {
    type: string;
}, port?: TerminalPort): {
    state: TerminalState;
    effects: Effect[];
} | undefined;
//# sourceMappingURL=terminal.d.ts.map