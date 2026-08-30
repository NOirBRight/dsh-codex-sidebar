/** Clone IPv4 host ICE candidates onto addresses both peers can actually reach. */
/** 127.0.0.1 plus non-fake-ip, non-internal IPv4s (Clash uses 198.18.0.0/15). */
export declare function extraHostIceAddresses(): string[];
/** Insert extra host lines next to each IPv4 host candidate in an SDP blob. */
export declare function sdpWithLoopbackHostCandidates(sdp: string, extras?: readonly string[]): string;
/** Clone one trickle host candidate onto shared addresses. */
export declare function candidateWithLoopbackHost(candidate: string, extras?: readonly string[]): string[];
//# sourceMappingURL=managed-browser-ice-loopback.d.ts.map