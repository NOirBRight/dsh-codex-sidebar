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
export declare function reviewChangesFromSnapshot(snapshot: unknown): ReviewChange[];
export declare function hunkForOpen(snapshot: unknown, path: string, tool?: string): {
    before: string;
    after: string;
} | undefined;
//# sourceMappingURL=tool-open.d.ts.map