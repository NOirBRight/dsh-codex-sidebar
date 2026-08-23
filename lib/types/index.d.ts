/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */
export { createSidebarSession, PALETTE } from './session.ts';
export type { Annotation, AnnotationSource, Effect, FilesPort, Intent, PersistPort, SidebarSession, SidebarSnapshot, ToolKind, } from './session.ts';
export { createRegistry } from './registry.ts';
export { SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_FILE_READ_ENDPOINT, SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, } from './contract.ts';
export { formatDelivery, formatEvidenceSend, formatHumanSend, formatSend } from './send-text.ts';
export declare const name = "dsh-codex-sidebar";
export declare const inject: string[];
type RpcHandle = {
    handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>, options: {
        authority: string;
    }) => void;
};
type ToolsHost = {
    register: (definition: unknown) => () => void;
    guard?: (fn: (exec: {
        name: string;
        agent?: {
            session?: {
                header?: {
                    parentSession?: string;
                    origin?: string;
                };
            };
        };
    }) => string | undefined) => () => void;
};
type PromptHost = {
    section: (section: {
        name: string;
        order: number;
        text: string;
    }) => () => void;
};
type WebServerHost = {
    registerUpgrade: (route: {
        path: string;
        handler: (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void;
    }) => () => void;
};
type EffectContext = {
    effect: (callback: () => void | (() => void), label?: string) => void;
};
type HostContext = EffectContext & {
    inject: (deps: readonly string[], callback: (ctx: EffectContext & {
        connection?: {
            rpc: RpcHandle;
        };
        tools?: ToolsHost;
        systemPrompt?: PromptHost;
        webServer?: WebServerHost;
        agents?: {
            get(id: string): unknown;
        };
        attachments?: {
            saveImage(input: {
                data: Uint8Array;
                mediaType: 'image/jpeg';
                name?: string;
            }): Promise<{
                attachmentId: string;
                mediaType: 'image/jpeg';
                bytes: number;
                width: number;
                height: number;
                name?: string;
            }>;
        };
    }) => void) => void;
};
export declare function apply(ctx: HostContext): void;
//# sourceMappingURL=index.d.ts.map