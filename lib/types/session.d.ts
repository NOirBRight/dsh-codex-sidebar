/** Deep module: 侧栏 chrome + Files 工具. Tests and the plugin cross this seam. */
import type { BrowserIntent, BrowserPort, BrowserState } from './browser.ts';
import type { FileDiff, ReviewIntent, ReviewPort, ReviewState } from './review.ts';
import type { SideChatIntent, SideChatPort, SideChatState } from './side-chat.ts';
import type { TerminalIntent, TerminalPort, TerminalState } from './terminal.ts';
export declare const PALETTE: readonly ["Review", "Terminal", "Browser", "Files"];
export declare const MAX_DELIVERED_MARKS = 100;
export declare function retireSideChatTabs(tabs: readonly Tab[], active: string | null): {
    tabs: Tab[];
    active: string | null;
};
export type ToolKind = (typeof PALETTE)[number];
export type Tab = {
    id: string;
    kind: ToolKind | null;
    target: string;
    title: string;
};
export type AnnotationSource = 'files' | 'browser' | 'review';
export type AnnotationRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export type AnnotationTextRange = {
    start: number;
    end: number;
};
export type BrowserEvidence = {
    id: string;
    captureId: string;
    documentId: string;
    layoutRevision: number;
    mediaGeneration: number;
    ref: string;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
};
export type Annotation = {
    id: string;
    text: string;
    from: string;
    source: AnnotationSource;
    selector?: string;
    path?: string;
    line?: number;
    rect?: AnnotationRect;
    selection?: AnnotationTextRange;
    url?: string;
    evidence?: BrowserEvidence;
};
export type NotePos = {
    x: number;
    y: number;
};
export type TreeNode = {
    path: string;
    name: string;
    kind?: 'file' | 'dir';
};
export type FileChange = {
    before: string;
    after: string;
};
export type FilesPort = {
    read(path: string): string | undefined;
    tree(): TreeNode[];
    change?(path: string): FileChange | undefined;
    stats?(): Record<string, {
        added: number;
        removed: number;
    }>;
};
export type PersistPort = {
    load(sessionId: string): SidebarSnapshot | undefined;
    save(sessionId: string, snapshot: SidebarSnapshot): void;
    flush?(): void | Promise<void>;
};
export type Effect = {
    type: 'send';
    text: string;
    attachments: Annotation[];
} | {
    type: 'queue';
    text: string;
    attachments: Annotation[];
} | {
    type: 'deliver';
    to: string;
    text: string;
    sourceTab: string;
    sourceSession: string;
} | {
    type: 'side-ask';
    tabId: string;
    text: string;
    atSeq: number | null;
};
export type Intent = {
    type: 'pick-tool';
    kind: ToolKind;
} | {
    type: 'open-empty-tab';
} | {
    type: 'open-terminal';
} | {
    type: 'close-tab';
    id: string;
} | {
    type: 'select-tab';
    id: string;
} | {
    type: 'toggle-collapsed';
} | {
    type: 'open-path';
    path: string;
    view?: 'preview' | 'diff';
    before?: string;
    after?: string;
} | {
    type: 'select-file';
    path: string;
} | {
    type: 'toggle-tree';
} | {
    type: 'set-files-view';
    view: 'preview' | 'diff';
} | {
    type: 'set-tree-width';
    width: number;
} | {
    type: 'set-annotate';
    on: boolean;
} | {
    type: 'click-content';
    mark: string;
    x: number;
    y: number;
    rect?: AnnotationRect;
    selection?: AnnotationTextRange;
} | {
    type: 'dismiss-note';
} | {
    type: 'note-add';
} | {
    type: 'note-send';
} | {
    type: 'composer-send';
    text: string;
} | {
    type: 'restore-attachments';
    attachments: Annotation[];
} | {
    type: 'set-note-draft';
    text: string;
} | {
    type: 'edit-attachment';
    id: string;
    x?: number;
    y?: number;
} | {
    type: 'reveal-mark';
    mark: Annotation;
} | {
    type: 'remove-attachment';
    id: string;
} | {
    type: 'reorder-tabs';
    from: number;
    to: number;
} | ReviewIntent | BrowserIntent | TerminalIntent | SideChatIntent;
export type SidebarSnapshot = {
    sessionId: string;
    collapsed: boolean;
    tabs: Tab[];
    active: string | null;
    showPalette: boolean;
    palette: readonly ToolKind[];
    files: {
        path: string;
        preview: string | undefined;
        tree: TreeNode[];
        treeOpen: boolean;
        treeWidth: number;
        view: 'preview' | 'diff';
        hunk: FileChange | null;
        diff: FileDiff | null;
        annotate: boolean;
        pendingMark: string | null;
        pendingRect: AnnotationRect | null;
        pendingSelection: AnnotationTextRange | null;
        notePos: NotePos | null;
        noteDraft: string;
        editingId: string | null;
    };
    fileStats: Record<string, {
        added: number;
        removed: number;
    }>;
    review: ReviewState;
    browser: BrowserState;
    browsers: Record<string, BrowserState>;
    terminal: TerminalState;
    sideChat: SideChatState;
    attachments: Annotation[];
    deliveredMarks: Annotation[];
    queue: Array<{
        text: string;
        attachments: Annotation[];
    }>;
};
export type SessionOptions = {
    sessionId: string;
    files: FilesPort;
    persist: PersistPort;
    isBusy: () => boolean;
    review?: ReviewPort;
    browser?: BrowserPort;
    terminal?: TerminalPort;
    sideChat?: SideChatPort;
};
export type SidebarSession = {
    /** Set project=false for a pure in-memory snapshot with no Files/Review I/O. */
    snapshot(project?: boolean): SidebarSnapshot;
    /** Monotonic state revision used to reject stale async projections. */
    revision(): number;
    dispatch(intent: Intent): Effect[];
    pullTerminal(tabId: string, since: number): {
        seq: number;
        chunk: string;
    };
};
export declare function createSidebarSession(opts: SessionOptions): SidebarSession;
//# sourceMappingURL=session.d.ts.map