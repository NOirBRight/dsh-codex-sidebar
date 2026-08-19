import type { TreeNode } from './session.ts';
export type TreeEntry = {
    kind: 'dir';
    path: string;
    name: string;
    depth: number;
    open: boolean;
} | {
    kind: 'file';
    path: string;
    name: string;
    depth: number;
};
export declare function ancestorsOf(path: string): Set<string>;
export declare function visibleTree(nodes: readonly TreeNode[], expanded: Set<string>, query: string): TreeEntry[];
//# sourceMappingURL=file-tree.d.ts.map