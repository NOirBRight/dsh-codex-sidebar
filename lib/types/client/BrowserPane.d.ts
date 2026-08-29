/** Managed Chromium Browser chrome, Canvas stream, and screenshot-backed 批注. */
import { type ReactElement } from 'react';
import { type BrowserState } from '../browser.ts';
import type { Intent, SidebarSnapshot } from '../session.ts';
import type { BrowserCaptureReply } from './controller.ts';
import type { BrowserLayout } from '../managed-browser-protocol.ts';
type Ticket = {
    path: string;
    expiresAt: number;
};
export declare function BrowserPane({ snapshot, browser, tabId, active, onIntent, requestTicket, requestCapture, sendLabel, addLabel, deleteLabel }: {
    snapshot: SidebarSnapshot;
    browser: BrowserState;
    tabId: string;
    active: boolean;
    onIntent: (intent: Intent) => void;
    requestTicket: (tabId: string) => Promise<Ticket | undefined>;
    requestCapture: (tabId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>) => Promise<BrowserCaptureReply | undefined>;
    sendLabel: string;
    addLabel: string;
    deleteLabel: string;
}): ReactElement;
export {};
//# sourceMappingURL=BrowserPane.d.ts.map