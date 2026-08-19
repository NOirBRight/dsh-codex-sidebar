/** Host SideChatPort: live cwd read/search; log / 列出 / 投递 from the RPC gate. */
import type { FilesPort } from './session.ts';
import type { SideChatPort } from './side-chat.ts';
import type { SessionIo } from './registry.ts';
export declare function createHostSideChat(opts: {
    sessionId: string;
    files: FilesPort;
    io: SessionIo;
}): SideChatPort;
//# sourceMappingURL=host-side-chat.d.ts.map