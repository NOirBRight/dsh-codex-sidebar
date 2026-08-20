/** Async, bounded workspace projection for visible Files/Review tools. */
import type { SidebarSnapshot } from './session.ts';
import { type FileDiff, type ReviewChange } from './review.ts';
export type WorkspaceGate = {
    cwd: string;
    turnWrites?: ReviewChange[];
};
export type AsyncGitExec = (args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<string>;
export type WorkspaceInspector = {
    project(snapshot: SidebarSnapshot, gate: WorkspaceGate, signal?: AbortSignal): Promise<SidebarSnapshot>;
    execCount(): number;
    clear(): void;
};
type Stat = {
    added: number;
    removed: number;
    binary?: boolean;
};
export declare function createWorkspaceInspector(opts?: {
    gitExec?: AsyncGitExec;
    ttlMs?: number;
    now?: () => number;
}): WorkspaceInspector;
export declare function parsePatch(patch: string): FileDiff | null;
export declare function parseNumstat(raw: string): Record<string, Stat>;
export {};
//# sourceMappingURL=workspace-inspector.d.ts.map