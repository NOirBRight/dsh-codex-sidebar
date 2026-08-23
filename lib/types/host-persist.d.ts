/** Persist one SidebarSession JSON blob per 主会话 id. */
import type { PersistPort } from './session.ts';
export declare const PERSIST_DEBOUNCE_MS = 500;
export type FilePersist = PersistPort & {
    flush(): Promise<void>;
};
export declare function sidebarPersistRoot(env?: NodeJS.ProcessEnv): string;
export declare function createFilePersist(root?: string, legacyRootOverride?: string): FilePersist;
//# sourceMappingURL=host-persist.d.ts.map