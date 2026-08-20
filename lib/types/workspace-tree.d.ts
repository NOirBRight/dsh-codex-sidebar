/** Bounded workspace listing: breadth-first, fair per-directory cap. */
import type { TreeNode } from './session.ts';
export declare const MAX_TREE_NODES = 400;
export declare const SKIP_WALK: Set<string>;
export declare const SKIP_SHOW: Set<string>;
export declare const SHOW_COLLAPSED: Set<string>;
export declare function collectTree(root: string, signal?: AbortSignal): TreeNode[];
//# sourceMappingURL=workspace-tree.d.ts.map