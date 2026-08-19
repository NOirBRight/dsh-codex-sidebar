/** BrowserPort: synchronous chrome projection plus async managed-Page commands. */
import { type BrowserPort, type PageDocument } from './browser.ts';
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts';
/** Optional HTML snapshot for tests. Production load never waits on the network. */
export type PageProbe = {
    kind: 'html';
    html: string;
} | {
    kind: 'unreachable';
};
export declare function createHostBrowser(opts: {
    isBusy: () => boolean;
    probe?: (url: string) => PageProbe;
    openExternal?: (url: string) => void;
    managed?: {
        runtime: ManagedBrowserRuntime;
        sessionId: string;
    };
}): BrowserPort;
export declare function liveSnapshot(url: string): PageDocument;
export declare function pageSnapshot(url: string, html: string): PageDocument;
//# sourceMappingURL=host-browser.d.ts.map