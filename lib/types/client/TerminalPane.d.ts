/** Terminal 工具 pane: xterm.js over the human pty, one emulator per Tab. */
import { type ReactElement } from 'react';
import type { Intent, SidebarSnapshot } from '../session.ts';
export declare function TerminalPane({ snapshot, onIntent, tabId, onPull, }: {
    snapshot: SidebarSnapshot;
    onIntent: (intent: Intent) => void;
    tabId: string;
    onPull?: (tabId: string, since: number) => Promise<{
        seq: number;
        chunk: string;
    } | undefined>;
}): ReactElement;
//# sourceMappingURL=TerminalPane.d.ts.map