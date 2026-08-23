/** Decode sidebar RPC and run it against the per-主会话 registry. */
import type { createRegistry } from './registry.ts';
import type { ManagedBrowserStream } from './managed-browser-stream.ts';
import type { ManagedBrowserRuntime } from './managed-browser-runtime.ts';
import type { ManagedBrowserEvidenceStore } from './managed-browser-evidence.ts';
import { type WorkspaceInspector } from './workspace-inspector.ts';
import { AnnotationSendStore, type AnnotationSendPorts } from './host-annotation-send.ts';
type Registry = ReturnType<typeof createRegistry>;
export type RpcResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        message: string;
    };
};
export type SidebarRpcServices = {
    browserStream?: ManagedBrowserStream;
    managedBrowser?: ManagedBrowserRuntime;
    browserEvidence?: ManagedBrowserEvidenceStore;
    annotationSend?: AnnotationSendStore;
    annotationPortsFor?: (sessionId: string) => AnnotationSendPorts;
    workspace?: WorkspaceInspector;
};
export declare function handleSidebarRpcAsync(registry: Registry, endpoint: string, payload: unknown, services?: SidebarRpcServices): Promise<RpcResult<unknown>>;
export declare function handleSidebarRpc(registry: Registry, endpoint: string, payload: unknown, services?: SidebarRpcServices): RpcResult<unknown>;
export {};
//# sourceMappingURL=host-rpc.d.ts.map