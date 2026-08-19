/** Authenticated same-origin screencast and input transport for managed Browser Tabs. */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ManagedBrowserRuntime, ManagedTabKey } from './managed-browser-runtime.ts';
export declare const MANAGED_BROWSER_STREAM_PATH = "/__dcs/browser-stream";
export declare const MANAGED_BROWSER_STREAM_VERSION = 1;
export type BrowserStreamTicket = {
    ticket: string;
    path: string;
    expiresAt: number;
};
export type BrowserStreamFrame = {
    version: number;
    sequence: number;
    sentAt: number;
    width: number;
    height: number;
    jpeg: Uint8Array;
};
export type ManagedBrowserStreamOptions = {
    runtime: ManagedBrowserRuntime;
    now?: () => number;
    ticketTtlMs?: number;
};
export declare class ManagedBrowserStream {
    #private;
    constructor(opts: ManagedBrowserStreamOptions);
    issue(tab: ManagedTabKey): BrowserStreamTicket;
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    dispose(): Promise<void>;
    consume(ticket: string): ManagedTabKey | undefined;
}
export declare function encodeBrowserStreamFrame(frame: BrowserStreamFrame): Uint8Array;
export declare function decodeBrowserStreamFrame(value: ArrayBuffer | Uint8Array): BrowserStreamFrame;
//# sourceMappingURL=managed-browser-stream.d.ts.map