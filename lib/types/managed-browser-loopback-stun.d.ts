/** Loopback-only STUN so GUI Chrome and the encoder Page can ICE on 127.0.0.1. */
export type LoopbackStunServer = {
    url: string;
    close: () => Promise<void>;
};
/** Bind a STUN responder on 127.0.0.1 so both WebRTC peers share a loopback srflx pair. */
export declare function startLoopbackStunServer(): Promise<LoopbackStunServer>;
export declare function stunBindingSuccess(request: Uint8Array, ip: string, port: number): Buffer | undefined;
//# sourceMappingURL=managed-browser-loopback-stun.d.ts.map