/** 侧栏开关 button. The overlay host keeps it mounted so a collapse/expand swap cannot hide it. */
import type { ReactElement } from 'react';
import type { SidebarKey } from './locales.ts';
export declare function SidebarToggleButton({ collapsed, t, onClick, }: {
    collapsed: boolean;
    t: (key: Extract<SidebarKey, 'toggleShow' | 'toggleHide'>) => string;
    onClick: () => void;
}): ReactElement;
//# sourceMappingURL=Toggle.d.ts.map