/** Details-column occupant: Tab strip, Palette, and the active 工具. */
import { type ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ObservableSnapshot } from './shim.js';
import { NS } from './locales.ts';
import type { SidebarStore } from './controller.ts';
import { SidebarController } from './controller.ts';
export interface SidebarFace {
    hooks: {
        sidebar: ObservableSnapshot<SidebarStore>;
    };
    controller: SidebarController;
}
export type SidebarProps = PropsRuntime<'details'> & PropsLocale<typeof NS> & InjectFace<SidebarFace>;
export declare function SidebarPanel({ sessionId, useSessions, useSidebar, controller, t, }: SidebarProps): ReactNode;
//# sourceMappingURL=Sidebar.d.ts.map