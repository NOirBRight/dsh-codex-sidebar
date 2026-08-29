/** details slot occupancy: shadow the shipped DetailsPanel (priority 0). */
export declare const DETAILS_SLOT = "details";
export declare const DETAILS_PRIORITY = -100;
export declare const DEFAULT_DETAILS_PRIORITY = 0;
/** Every service read through ClientContext must be injected; otherwise its proxy throws at runtime. */
export declare const CLIENT_INJECT: readonly ["slots", "locale", "connection", "layout", "sessions", "workspaces", "remote"];
export type DetailsSlots = {
    inject: (key: string, callback: () => void) => unknown;
    register: (options: {
        name: string;
        locale: string;
        priority: number;
        inject: () => unknown;
    }, component: unknown) => unknown;
};
export declare function shadowsDefaultDetails(priority: number): boolean;
/** AppFrame owns the details track (`details: 0` closed). CSS vars do not open it. */
export declare function detailsTrackShouldOpen(collapsed: boolean | undefined): boolean;
export declare function applyDetailsTrack(layout: {
    openDetails(): void;
    closeDetails(): void;
}, collapsed: boolean | undefined): void;
export declare function occupyDetails(slots: DetailsSlots, face: unknown, panel: unknown, locale: string): void;
//# sourceMappingURL=details-occupancy.d.ts.map