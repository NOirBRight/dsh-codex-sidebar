/** Duplicate IPv4 host ICE candidates onto 127.0.0.1 when the socket is bound to 0.0.0.0. */
/** Insert 127.0.0.1 host lines next to non-loopback IPv4 host candidates in an SDP blob. */
export declare function sdpWithLoopbackHostCandidates(sdp: string): string;
/** Clone one trickle host candidate onto 127.0.0.1; leave other candidates unchanged. */
export declare function candidateWithLoopbackHost(candidate: string): string | undefined;
//# sourceMappingURL=managed-browser-ice-loopback.d.ts.map