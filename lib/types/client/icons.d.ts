/** Prototype-faithful icons. Stroke follows currentColor so the host theme paints them. */
import type { ReactElement } from 'react';
export type IconName = 'review' | 'terminal' | 'globe' | 'folder' | 'chat' | 'panel' | 'plus' | 'x' | 'pencil' | 'tree' | 'file' | 'search' | 'chevron' | 'back' | 'fwd' | 'refresh' | 'external' | 'file-plus' | 'folder-plus' | 'more' | 'inspect' | 'device-responsive' | 'device-phone' | 'device-tablet' | 'device-laptop' | 'chevron-down' | 'send' | 'enter' | 'trash';
export declare function Ico({ name, size }: {
    name: IconName;
    size?: number;
}): ReactElement;
export declare function tabIcon(kind: string | null): IconName;
export declare function FileGlyph({ name }: {
    name: string;
}): ReactElement;
//# sourceMappingURL=icons.d.ts.map