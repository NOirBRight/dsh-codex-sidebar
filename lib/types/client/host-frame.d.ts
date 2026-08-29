/** Read/write AppFrame grid tracks so the 侧栏 can squeeze the center column. */
export declare function sidebarTrackFromGrid(gridTemplateColumns: string): string | undefined;
export declare function detailsTrackPx(collapsed: boolean | undefined, width: number): string;
export declare function closedDetailsGrid(sidebarPx: string): string;
/** Drop a leftover 侧栏 track when New Session has no 主会话. */
export declare function clearDetailsTrackStyle(frame: {
    style: {
        setProperty(name: string, value: string): void;
    };
    removeAttribute(name: string): void;
}): void;
/** Stamp plugin-owned markers on the host frame so CSS never matches CSS-module hashes. */
export declare function markHostFrame(frame: HTMLElement): void;
/** Locate the details column via the plugin marker, then the overlay's previous sibling. */
export declare function detailsColumnOf(frame: ParentNode | null | undefined): HTMLElement | undefined;
/** Pin the details track immediately so ResizeObserver cannot restore a stale open width. */
export declare function pinHostDetailsTrack(collapsed: boolean | undefined): void;
//# sourceMappingURL=host-frame.d.ts.map