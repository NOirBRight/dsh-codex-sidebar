/**
 * 侧栏 width. Host AppFrame clamps details at DETAILS_MAX=520 in JS; we still
 * squeeze a third grid track via CSS variables, capped at min(70vw, 960px).
 */
export declare const DRAWER_MIN = 320;
export declare const DRAWER_MAX = 960;
export declare const DRAWER_DEFAULT = 560;
export declare const DRAWER_VW = 0.7;
export declare const DRAWER_STORAGE_KEY = "dsh-codex-sidebar.drawer-width";
export type DrawerWidthStore = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};
export declare function clampDrawerWidth(px: number, viewport: number): number;
export declare function readDrawerWidth(store: DrawerWidthStore | undefined, viewport: number): number;
export declare function writeDrawerWidth(store: DrawerWidthStore | undefined, px: number, viewport: number): number;
export declare function browserDrawerStore(): DrawerWidthStore | undefined;
export declare function peekDrawerWidth(viewport: number): number;
export declare function publishDrawerWidth(px: number, viewport: number): number;
export declare function subscribeDrawerWidth(listener: (px: number) => void): () => void;
//# sourceMappingURL=drawer-width.d.ts.map