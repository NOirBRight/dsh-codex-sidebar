/** Persist one SidebarSession JSON blob per 主会话 id. */
import type { PersistPort } from './session.ts';
export declare function sidebarPersistRoot(env?: NodeJS.ProcessEnv): string;
export declare function createFilePersist(root?: string, legacyRootOverride?: string): PersistPort;
//# sourceMappingURL=host-persist.d.ts.map