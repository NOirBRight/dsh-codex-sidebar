/** 主会话 tools that drive Host-managed Chromium Browser Tabs. */
import { type DriveCaller, type DriveResult, type DriveTab } from './browser-drive.ts';
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts';
import type { SidebarSession } from './session.ts';
export declare const BROWSER_DRIVE_TOOLS: readonly ["browser_tabs", "browser_open", "browser_snapshot", "browser_click", "browser_fill"];
export type BrowserDriveService = {
    tabs(caller: DriveCaller | undefined, session: SidebarSession): {
        ok: true;
        tabs: DriveTab[];
    } | DriveResult;
    open(caller: DriveCaller | undefined, session: SidebarSession, url: string): Promise<{
        ok: true;
        tab: DriveTab;
    } | DriveResult>;
    snapshot(caller: DriveCaller | undefined, session: SidebarSession, tabId?: string): Promise<DriveResult>;
    click(caller: DriveCaller | undefined, session: SidebarSession, ref: string, tabId?: string): Promise<DriveResult>;
    fill(caller: DriveCaller | undefined, session: SidebarSession, ref: string, text: string, tabId?: string): Promise<DriveResult>;
};
export declare function createManagedBrowserDriveService(runtime: ManagedBrowserRuntime): BrowserDriveService;
//# sourceMappingURL=host-browser-tools.d.ts.map