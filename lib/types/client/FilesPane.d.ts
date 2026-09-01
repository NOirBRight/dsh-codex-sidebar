/** Files 工具: read-only preview + closable tree + 批注 at the mark. */
import { type ReactElement } from 'react';
import type { Intent, SidebarSnapshot } from '../session.ts';
export declare function FilesPane({ snapshot, workspaceName, onIntent, onFilePreview, annotateLabel, openTreeLabel, closeTreeLabel, notePlaceholder, sendLabel, addLabel, deleteLabel, previewLabel, diffLabel, }: {
    snapshot: SidebarSnapshot;
    workspaceName: string;
    onIntent: (intent: Intent) => void;
    onFilePreview?: (path: string) => Promise<string | undefined>;
    annotateLabel: string;
    openTreeLabel: string;
    closeTreeLabel: string;
    notePlaceholder: string;
    sendLabel: string;
    addLabel: string;
    deleteLabel: string;
    previewLabel: string;
    diffLabel: string;
}): ReactElement;
//# sourceMappingURL=FilesPane.d.ts.map