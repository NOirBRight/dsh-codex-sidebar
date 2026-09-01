/** DSH single-slot renderer abdicates on an uncaught render crash. Hold the error in-tree instead. */
export type OccupantHold = {
    abdicate: false;
    message: string;
};
export declare function retainDetailsOccupantAfterRenderError(error: unknown): OccupantHold;
//# sourceMappingURL=occupant-hold.d.ts.map