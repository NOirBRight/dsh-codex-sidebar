/**
 * Pins AppFrame's third grid track to the 侧栏 width so the center column
 * is squeezed (3-column layout). The 侧栏开关 and resize handle live here
 * so the switch stays put and the pill stays on the real seam.
 */
import { type ReactElement } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
import type { SidebarFace } from './Sidebar.tsx';
export type DrawerProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<SidebarFace>;
export declare function NarrowDrawer(props: DrawerProps): ReactElement;
//# sourceMappingURL=NarrowDrawer.d.ts.map