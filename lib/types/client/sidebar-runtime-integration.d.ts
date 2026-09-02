/**
 * Temporary Alpha.4 runtime integration adapter for dsh-codex-sidebar.
 *
 * DSH Alpha.4 does not expose the transcript, layout, or workspace extension
 * seams needed by this client. This adapter is the approved Alpha.4 exception:
 * it patches only those three surfaces and restores every patch it owns.
 *
 * The adapter never claims a takeover until the active-session dispatch returns
 * a result. Workspace and Remote calls then use the official opener when the
 * dispatch is unavailable or fails. Transcript URL listeners leave the native
 * anchor behavior untouched until a dispatch succeeds.
 */
import { type ToolRowHunk } from './tool-stats.ts';
import type { Intent } from '../session.ts';
import type { ClientContext } from './shim.ts';
export type CapturedToolContext = {
    lastTool?: string | undefined;
    lastHunkId?: string | undefined;
    lastRowHunk?: ToolRowHunk | undefined;
};
export type IntegrationCallbacks = {
    dispatch: (sessionId: string, intent: Intent) => Promise<unknown>;
    openPath: (path: string, captured: CapturedToolContext) => Promise<boolean>;
    onLayoutOpen: () => void;
};
/**
 * Install the temporary Alpha.4 Host and DOM runtime integration behavior.
 * @param ctx - Client context carrying the Alpha.4 services.
 * @param callbacks - Sidebar dispatch and layout callbacks.
 * @param bootLayout - Layout face captured during client setup.
 * @returns an idempotent disposer for the installed runtime integration behavior.
 */
export declare class SidebarRuntimeIntegration {
    #private;
    constructor(ctx: ClientContext, callbacks: IntegrationCallbacks, bootLayout?: unknown);
    /** Install once; a later call returns a no-op disposer. */
    install(): () => void;
    /** Restore every owned patch and listener in reverse installation order. */
    dispose(): void;
    /**
     * Open a decorated transcript path, falling back to the official workspace opener.
     * @param path - Transcript path or URL.
     * @returns true for a Sidebar takeover and false after official fallback.
     */
    tryOpenTranscriptPath(path: string): Promise<boolean> | undefined;
    /** Retry layout patching after Alpha.4 replaces the layout face. */
    ensureLayoutPatched(): void;
}
//# sourceMappingURL=sidebar-runtime-integration.d.ts.map