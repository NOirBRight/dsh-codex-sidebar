/** Palette inside an empty Tab, and the + menu that fills a Tab in one click. */
import type { ReactElement } from 'react';
import type { ToolKind } from '../session.ts';
import { type IconName } from './icons.tsx';
export declare const TOOL_ROWS: ReadonlyArray<{
    kind: ToolKind;
    icon: IconName;
    shortcut: string;
}>;
export declare function Palette({ onPick }: {
    onPick: (kind: ToolKind) => void;
}): ReactElement;
export declare function AddMenu({ onPick }: {
    onPick: (kind: ToolKind) => void;
}): ReactElement;
//# sourceMappingURL=Palette.d.ts.map