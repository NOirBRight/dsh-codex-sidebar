/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */

import { SIDEBAR_RPC_CHANNEL } from './contract.ts'
import { createFsFiles } from './host-files.ts'
import { createFilePersist } from './host-persist.ts'
import { handleSidebarRpc } from './host-rpc.ts'
import { createHostSideChat } from './host-side-chat.ts'
import { createRegistry } from './registry.ts'
import type { FilesPort } from './session.ts'

export { createSidebarSession, PALETTE } from './session.ts'
export type {
  Annotation, Effect, FilesPort, Intent, PersistPort, SidebarSession, SidebarSnapshot, ToolKind,
} from './session.ts'
export { createRegistry } from './registry.ts'
export {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
} from './contract.ts'
export { formatSend } from './send-text.ts'

export const name = 'dsh-codex-sidebar'
export const inject = ['connection']

type RpcHandle = {
  handle: (
    channel: string,
    handler: (endpoint: string, payload: unknown) => Promise<unknown>,
    options: { authority: string },
  ) => void
}

type HostContext = {
  inject: (deps: readonly string[], callback: (ctx: { connection: { rpc: RpcHandle } }) => void) => void
}

export function apply(ctx: HostContext): void {
  const filesBySession = new Map<string, FilesPort>()
  const registry = createRegistry({
    persist: createFilePersist(),
    filesFor: (sessionId, cwdOf) => {
      const files = createFsFiles(cwdOf)
      filesBySession.set(sessionId, files)
      return files
    },
    sideChatFor: (sessionId) => createHostSideChat({
      sessionId,
      files: filesBySession.get(sessionId) ?? createFsFiles(() => ''),
    }),
  })
  ctx.inject(['connection'], (wired) => {
    wired.connection.rpc.handle(
      SIDEBAR_RPC_CHANNEL,
      (endpoint, payload) => Promise.resolve(handleSidebarRpc(registry, endpoint, payload)),
      { authority: 'loopback' },
    )
  })
}
