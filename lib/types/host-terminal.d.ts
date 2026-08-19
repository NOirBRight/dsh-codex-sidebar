/** Host TerminalPort: one real pty per Tab, cwd is the 主会话 workspace. Reconnect by token. */
import { type TerminalPort } from './terminal.ts';
export declare function createHostTerminal(cwdOf: () => string): TerminalPort;
//# sourceMappingURL=host-terminal.d.ts.map