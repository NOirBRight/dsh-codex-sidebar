/** Side Chat 工具: frozen Fork, 列出 / 察看 / 投递, read-only workspace. */
import type { Effect } from './session.ts';
export type LogEvent = {
    seq: number;
    turn: number;
    role: 'user' | 'assistant' | 'tool-call' | 'tool-result';
    text: string;
    closed?: boolean;
    writes?: string[];
    before?: string;
    after?: string;
};
export type RosterKind = 'main' | 'subagent' | 'side-chat';
export type RosterEntry = {
    id: string;
    title: string;
    cwd: string;
    kind: RosterKind;
    archived: boolean;
    busy: boolean;
};
export type ListedMain = {
    id: string;
    title: string;
    cwd: string;
    busy: boolean;
};
export type ProgressCard = {
    sessionId: string;
    title: string;
    busy: boolean;
    turn: number;
    step: number;
    last: string;
    files: string[];
};
export type SearchHit = {
    path: string;
    text: string;
};
export type SideChatMessage = {
    kind: 'user';
    text: string;
} | {
    kind: 'side';
    text: string;
} | {
    kind: 'read';
    path: string;
    text: string;
} | {
    kind: 'search';
    query: string;
    hits: SearchHit[];
} | {
    kind: 'delivery';
    to: string;
    text: string;
    status: 'sent' | 'queued';
} | {
    kind: 'delivery';
    to: string;
    text: string;
    status: 'failed';
    error: string;
};
export type SideChatTabState = {
    forked: boolean;
    forkSeq: number | null;
    forkSessionId: string | null;
    fork: LogEvent[];
    messages: SideChatMessage[];
    listed: ListedMain[] | null;
    card: ProgressCard | null;
    error: string | null;
    draft: string;
};
export type SideChatState = {
    byTab: Record<string, SideChatTabState>;
};
export type SourcedDelivery = {
    role: 'sourced';
    to: string;
    text: string;
    sourceTab: string;
    sourceSession: string;
};
export type DeliverResult = {
    ok: true;
    queued: boolean;
} | {
    ok: false;
    error: string;
};
export type SideChatPort = {
    attachedId: string;
    log(sessionId: string): LogEvent[];
    roster(): RosterEntry[];
    read(path: string): string | undefined;
    search(query: string): SearchHit[];
    deliver(payload: SourcedDelivery): DeliverResult;
};
export type SideChatIntent = {
    type: 'side-send';
    tabId: string;
    text: string;
} | {
    type: 'side-list';
    tabId: string;
    phrase?: string;
} | {
    type: 'side-inspect';
    tabId: string;
    sessionId: string;
} | {
    type: 'side-deliver';
    tabId: string;
    sessionId: string;
    text: string;
} | {
    type: 'side-read';
    tabId: string;
    path: string;
} | {
    type: 'side-search';
    tabId: string;
    query: string;
} | {
    type: 'side-write';
    tabId: string;
    path: string;
    text: string;
} | {
    type: 'side-pty';
    tabId: string;
    command: string;
} | {
    type: 'side-spawn';
    tabId: string;
} | {
    type: 'side-draft';
    tabId: string;
    text: string;
} | {
    type: 'side-bind-fork';
    tabId: string;
    sessionId: string;
} | {
    type: 'side-reply';
    tabId: string;
    text: string;
};
export declare function emptySideChat(): SideChatState;
export declare function emptySideTab(): SideChatTabState;
export declare function projectSideChat(state: SideChatState, _port?: SideChatPort): SideChatState;
export declare function reduceSideChat(state: SideChatState, intent: {
    type: string;
}, port?: SideChatPort): {
    state: SideChatState;
    effects: Effect[];
} | undefined;
export declare const PENDING_REPLY = "\u6B63\u5728\u56DE\u7B54\u2026";
//# sourceMappingURL=side-chat.d.ts.map