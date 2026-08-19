/** One SidebarSession per 主会话. */
import type { BrowserPort } from './browser.ts';
import type { ReviewChange, ReviewPort } from './review.ts';
import type { FilesPort, PersistPort, SidebarSession } from './session.ts';
import type { LogEvent, RosterEntry, SideChatPort } from './side-chat.ts';
import type { TerminalPort } from './terminal.ts';
export type SessionGate = {
    cwd: string;
    busy: boolean;
    turnWrites?: ReviewChange[];
    roster?: RosterEntry[];
    logs?: Record<string, LogEvent[]>;
};
export type SessionIo = {
    cwdOf: () => string;
    isBusy: () => boolean;
    turnWrites: () => ReviewChange[];
    roster: () => RosterEntry[];
    log: (id: string) => LogEvent[];
};
export type RegistryOptions = {
    persist: PersistPort;
    filesFor?: (sessionId: string, io: SessionIo) => FilesPort;
    reviewFor?: (sessionId: string, io: SessionIo) => ReviewPort;
    browserFor?: (sessionId: string, io: SessionIo) => BrowserPort;
    terminalFor?: (sessionId: string, io: SessionIo) => TerminalPort;
    sideChatFor?: (sessionId: string, io: SessionIo) => SideChatPort;
};
export declare function createRegistry(opts: RegistryOptions): {
    forSession(sessionId: string, gate: SessionGate): SidebarSession;
};
//# sourceMappingURL=registry.d.ts.map