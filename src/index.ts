/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */

import { SIDEBAR_RPC_CHANNEL } from './contract.ts'
import { createHostBrowser } from './host-browser.ts'
import { createFsFiles } from './host-files.ts'
import { createFilePersist } from './host-persist.ts'
import { createHostReview } from './host-review.ts'
import { handleSidebarRpc } from './host-rpc.ts'
import { createHostSideChat } from './host-side-chat.ts'
import { createHostTerminal } from './host-terminal.ts'
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
export { formatDelivery, formatSend } from './send-text.ts'

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
    filesFor: (sessionId, io) => {
      const files = createFsFiles(io.cwdOf)
      filesBySession.set(sessionId, files)
      return files
    },
    reviewFor: (_sessionId, io) => createHostReview({
      cwdOf: io.cwdOf,
      turnWrites: io.turnWrites,
      isBusy: io.isBusy,
    }),
    browserFor: (_sessionId, io) => createHostBrowser({ isBusy: io.isBusy }),
    terminalFor: (_sessionId, io) => createHostTerminal(io.cwdOf),
    sideChatFor: (sessionId, io) => createHostSideChat({
      sessionId,
      files: filesBySession.get(sessionId) ?? createFsFiles(io.cwdOf),
      io,
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
