/** Host/client RPC contract for one SidebarSession. */
import type { ReviewChange } from './review.ts';
import type { Effect, Intent, SidebarSnapshot } from './session.ts';
import type { LogEvent, RosterEntry } from './side-chat.ts';
export declare const SIDEBAR_RPC_CHANNEL = "/codex-sidebar";
export declare const SIDEBAR_SNAPSHOT_ENDPOINT = "sidebar/snapshot";
export declare const SIDEBAR_DISPATCH_ENDPOINT = "sidebar/dispatch";
export declare const SIDEBAR_FILE_READ_ENDPOINT = "sidebar/file-read";
export declare const SIDEBAR_TERMINAL_PULL_ENDPOINT = "sidebar/terminal-pull";
export declare const SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT = "sidebar/browser-stream-ticket";
export declare const SIDEBAR_BROWSER_CAPTURE_ENDPOINT = "sidebar/browser-capture";
export declare const SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT = "sidebar/browser-evidence-commit";
export declare const SIDEBAR_BROWSER_EVIDENCE_READ_ENDPOINT = "sidebar/browser-evidence-read";
export declare const SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT = "sidebar/stage-annotations";
export declare const SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT = "sidebar/unstage-annotations";
export type SnapshotRequest = {
    sessionId: string;
    cwd: string;
    busy: boolean;
    turnWrites: ReviewChange[];
    roster: RosterEntry[];
    logs: Record<string, LogEvent[]>;
    light?: boolean;
};
export type DispatchRequest = SnapshotRequest & {
    intent: Intent;
};
export type DispatchReply = {
    snapshot: SidebarSnapshot;
    effects: Effect[];
};
export type SnapshotReply = {
    snapshot: SidebarSnapshot;
};
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function decodeSnapshotRequest(payload: unknown): SnapshotRequest | undefined;
export declare function decodeDispatchRequest(payload: unknown): DispatchRequest | undefined;
//# sourceMappingURL=contract.d.ts.map