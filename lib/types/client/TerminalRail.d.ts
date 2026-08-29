/** Session rail inside Terminal: list, create, and switch human ptys. */
import { type ReactElement } from 'react';
import type { Intent, SidebarSnapshot } from '../session.ts';
import type { SidebarKey } from './locales.ts';
export declare function TerminalRail({ snapshot, onIntent, tabId, t, }: {
    snapshot: SidebarSnapshot;
    onIntent: (intent: Intent) => void;
    tabId: string;
    t: (key: SidebarKey) => string;
}): ReactElement;
//# sourceMappingURL=TerminalRail.d.ts.map