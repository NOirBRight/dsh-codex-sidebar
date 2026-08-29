/** Browser half: 3-column squeeze; 侧栏 occupies the details track. */
import type { ClientContext } from './shim.js';
import { type SidebarKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'codex-sidebar': SidebarKey;
    }
}
export declare const name = "dsh-codex-sidebar-client";
export declare const inject: ("slots" | "locale" | "connection" | "layout" | "sessions" | "workspaces" | "remote" | "remote.session")[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map