/** Flip/shift a floating 批注 chip so every character stays inside the pane. */
export declare const NOTE_PAD = 8;
export declare const NOTE_GAP = 12;
export declare const NOTE_ESTIMATE: {
    w: number;
    h: number;
};
export type PlaceBox = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export declare function placeNotePopover(anchor: PlaceBox, popover: {
    w: number;
    h: number;
}, view: PlaceBox, pad?: number, gap?: number): {
    x: number;
    y: number;
};
//# sourceMappingURL=note-place.d.ts.map