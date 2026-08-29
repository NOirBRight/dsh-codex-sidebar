/** When the sidebar RPC gate should ship full 本轮变更 payloads. */
export type TurnWritesSnapshot = {
    collapsed: boolean;
    active: string | null;
    tabs: Array<{
        id: string;
        kind: string | null;
    }>;
    attachments?: Array<{
        id: string;
        source?: string;
    }>;
};
export type TurnWritesIntent = {
    type: string;
    kind?: string;
    id?: string;
    mark?: string | {
        source?: string;
    };
};
export declare function needsTurnWrites(snapshot: TurnWritesSnapshot | undefined, intent?: TurnWritesIntent): boolean;
//# sourceMappingURL=turn-writes-gate.d.ts.map