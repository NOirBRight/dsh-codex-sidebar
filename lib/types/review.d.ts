/** Review 工具: read-only 本轮变更 / working tree. Ticket 02 owns this file. */
import type { Annotation, Effect } from './session.ts';
export type ReviewIntent = {
    type: 'review-switch';
    mode: ReviewMode;
} | {
    type: 'review-set-branch';
    branch: string;
} | {
    type: 'review-toggle-file';
    path: string;
} | {
    type: 'review-gutter';
    mark: string;
} | {
    type: 'review-set-note-draft';
    text: string;
} | {
    type: 'review-note-add';
} | {
    type: 'review-note-send';
} | {
    type: 'review-dismiss-note';
};
export type ReviewChange = {
    path: string;
    before: string;
    after: string;
};
export type ReviewMode = 'turn' | 'uncommitted' | 'staged' | 'unstaged' | 'tree';
export type ReviewScopeStats = {
    added: number;
    removed: number;
};
export type ReviewPort = {
    turnWrites(): ReviewChange[];
    workingTree(): ReviewChange[];
    staged?(): ReviewChange[];
    unstaged?(): ReviewChange[];
    branches?(): {
        current: string;
        names: string[];
    };
    against?(ref: string): ReviewChange[];
    isBusy(): boolean;
};
export type DiffLine = {
    kind: 'add' | 'del' | 'ctx';
    text: string;
    oldNo: number | null;
    newNo: number | null;
};
export type ReviewFile = {
    path: string;
    name: string;
    dir: string;
    added: number;
    removed: number;
    hunk: string;
    lines: DiffLine[];
};
export type ReviewState = {
    mode: ReviewMode;
    scopes: {
        turn: ReviewScopeStats;
        uncommitted: ReviewScopeStats;
        staged: ReviewScopeStats;
        unstaged: ReviewScopeStats;
    };
    branch: string;
    branches: {
        current: string;
        names: string[];
    };
    openPath: string | null;
    pendingMark: string | null;
    noteDraft: string;
    editingId: string | null;
    attachments: Annotation[];
    seq: number;
    files: ReviewFile[];
    openDiff: ReviewFile | null;
};
/** Keep composer fields, skip git-backed files/scopes until Review is open. */
export declare function rememberReview(state: ReviewState): ReviewState;
export declare function emptyReview(): ReviewState;
export declare function projectReview(state: ReviewState, port?: ReviewPort): ReviewState;
export declare function reduceReview(state: ReviewState, intent: {
    type: string;
}, port?: ReviewPort): {
    state: ReviewState;
    effects: Effect[];
} | undefined;
export type FileDiff = {
    added: number;
    removed: number;
    hunk: string;
    lines: DiffLine[];
};
export declare function fileDiff(before: string, after: string): FileDiff;
//# sourceMappingURL=review.d.ts.map