/** Register 主会话 Browser drive tools. */
import { type DriveCaller } from './browser-drive.ts';
import { type BrowserDriveService } from './host-browser-tools.ts';
import type { SidebarSession } from './session.ts';
type DriveExec = {
    agent?: {
        id?: string;
        status?: string;
        session?: {
            header?: DriveCaller & {
                cwd?: string;
            };
        };
    };
};
export type ToolsHost = {
    register(definition: unknown): () => void;
    guard?(fn: (exec: {
        name: string;
        agent?: {
            session?: {
                header?: DriveCaller;
            };
        };
    }) => string | undefined): () => void;
};
export declare const BROWSER_DRIVE_GUIDANCE: string;
export declare function registerBrowserDriveTools(tools: ToolsHost, service: BrowserDriveService, sessionOf: (exec: DriveExec) => SidebarSession | undefined, before?: () => Promise<void>): () => void;
export {};
//# sourceMappingURL=register-browser-tools.d.ts.map