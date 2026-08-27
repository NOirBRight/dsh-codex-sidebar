/** Private loopback projection for an explicitly selected local HTML directory. */
export type LocalHtmlNavigation = {
    /** Address retained in session state and client projections. */
    publicUrl: string;
    /** Private loopback address passed only to Host Chromium. */
    navigationUrl: string;
};
/** Fixed-memory diagnostics that never include paths, ports, or capabilities. */
export type LocalHtmlResources = {
    listening: boolean;
    leases: number;
};
/**
 * Serves one canonical local directory per Browser Tab over a random loopback
 * capability. The public `file:` address never crosses into the HTTP route.
 */
export declare class LocalHtmlGateway {
    #private;
    /** Resolve an explicit local HTML entry to a private Chromium navigation. */
    open(owner: string, rawUrl: string): Promise<LocalHtmlNavigation>;
    /** Map a current private Page URL back to its public local file address. */
    project(owner: string, navigationUrl: string): string | undefined;
    /** Whether an address belongs to the private listener, including a revoked route. */
    isPrivate(navigationUrl: string): boolean;
    /** Remove private listener and capability identities from an error string. */
    redact(owner: string, message: string): string;
    /** Revoke every local file route owned by one Browser Tab. */
    release(owner: string): void;
    /** Return path-free lifecycle counters. */
    resources(): LocalHtmlResources;
    /** Revoke all capabilities and close the private listener. */
    dispose(): Promise<void>;
}
//# sourceMappingURL=local-html-gateway.d.ts.map