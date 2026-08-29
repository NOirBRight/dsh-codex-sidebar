/** Serial interval pull: at most one request in flight; ignore results after stop. */
export type SerialPull = {
    seq: number;
    chunk: string;
};
export declare const SERIAL_PULL_MAX_INTERVAL_MS = 500;
export declare function startSerialPull(options: {
    intervalMs: number;
    maxIntervalMs?: number;
    pull: () => Promise<SerialPull | undefined>;
    onResult: (pulled: SerialPull) => void;
}): () => void;
//# sourceMappingURL=serial-pull.d.ts.map