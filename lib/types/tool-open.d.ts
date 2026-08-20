/** How a 主会话 path click should open Files — plugin-side, not DSH core. */
import { type ReviewChange } from './review.ts';
export declare const WRITE_TOOL: RegExp;
export type OpenHunk = {
    before: string;
    after: string;
    op: 'write' | 'edit';
};
export declare function viewForTool(toolName: string | undefined): 'preview' | 'diff';
export declare function statForLabel(stats: Record<string, {
    added: number;
    removed: number;
}>, label: string): {
    added: number;
    removed: number;
} | undefined;
export declare function statsFromSnapshot(snapshot: unknown): Record<string, {
    added: number;
    removed: number;
}>;
export type RowStat = {
    path: string;
    added: number;
    removed: number;
};
export type RowHunkStat = RowStat & {
    hunkId: string;
    before: string;
    after: string;
};
export declare function rowStatsFromSnapshot(snapshot: unknown): RowStat[];
/** Same row stats with a snapshot-local identity for exact path opening. */
export declare function rowHunksFromSnapshot(snapshot: unknown): RowHunkStat[];
type QueuedRow = {
    added: number;
    removed: number;
    hunkId?: string;
    before?: string;
    after?: string;
};
export declare function queueRowStats(rows: readonly (RowStat & {
    hunkId?: string;
    before?: string;
    after?: string;
})[]): Map<string, QueuedRow[]>;
export declare function takeRowStat(pending: Map<string, QueuedRow[]>, label: string): {
    added: number;
    removed: number;
} | undefined;
export declare function takeRowHunk(pending: Map<string, QueuedRow[]>, label: string): QueuedRow | undefined;
export declare function reviewChangesFromSnapshot(snapshot: unknown): ReviewChange[];
export declare function hunkForOpen(snapshot: unknown, path: string, tool?: string, hunkId?: string): {
    before: string;
    after: string;
} | undefined;
export {};
//# sourceMappingURL=tool-open.d.ts.map