/** One git status per repo generation. Shared by Files stats and Review. */
import type { ReviewChange } from './review.ts';
export type GitExec = (args: readonly string[], cwd: string) => string;
export type GitEntry = {
    path: string;
    x: string;
    y: string;
    untracked: boolean;
};
export type GitRepoStatus = {
    inside: boolean;
    branch: string;
    entries: GitEntry[];
};
export type GitChanges = {
    uncommitted: ReviewChange[];
    staged: ReviewChange[];
    unstaged: ReviewChange[];
};
export declare function defaultGitExec(args: readonly string[], cwd: string): string;
export declare function createGitRepo(exec?: GitExec): {
    status(cwd: string): GitRepoStatus;
    changes(cwd: string): GitChanges;
    numstat(cwd: string): Record<string, {
        added: number;
        removed: number;
    }>;
    branches(cwd: string): {
        current: string;
        names: string[];
    };
    inGit(cwd: string): boolean;
    execCount(): number;
    clear(): void;
};
export declare const gitRepo: {
    status(cwd: string): GitRepoStatus;
    changes(cwd: string): GitChanges;
    numstat(cwd: string): Record<string, {
        added: number;
        removed: number;
    }>;
    branches(cwd: string): {
        current: string;
        names: string[];
    };
    inGit(cwd: string): boolean;
    execCount(): number;
    clear(): void;
};
//# sourceMappingURL=git-status.d.ts.map