/** Stacked 批注 chips: 主会话 dock and 侧栏 chrome share this strip. */
import { type ReactNode } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ObservableSnapshot } from './shim.js';
import type { Annotation } from '../session.ts';
import { SidebarController, type SidebarStore } from './controller.ts';
export interface ChipsFace {
    hooks: {
        sidebar: ObservableSnapshot<SidebarStore>;
    };
    controller: SidebarController;
}
export type ChipsProps = PropsRuntime<'conversation.input.dock'> & InjectFace<ChipsFace>;
export declare function AttachmentChips({ sessionId, useSidebar, controller, input, inputActions }: ChipsProps): ReactNode;
export declare function AttachmentStrip({ attachments, onRemove, onEdit, onSend, dock, }: {
    attachments: readonly Annotation[];
    onRemove: (id: string) => void;
    onEdit?: (id: string) => void;
    onSend?: () => void;
    dock?: boolean;
}): ReactNode;
//# sourceMappingURL=AttachmentChips.d.ts.map