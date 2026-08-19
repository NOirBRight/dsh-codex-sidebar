/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */

import { SIDEBAR_RPC_CHANNEL } from './contract.ts'
import { createHostBrowser } from './host-browser.ts'
import { createBrowserDriveService } from './host-browser-tools.ts'
import { createLocalPickProxy } from './host-browser-proxy.ts'
import { pickProxyPath } from './browser-pick.ts'
import { BROWSER_DRIVE_GUIDANCE, registerBrowserDriveTools } from './register-browser-tools.ts'
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
  Annotation, AnnotationSource, Effect, FilesPort, Intent, PersistPort, SidebarSession, SidebarSnapshot, ToolKind,
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

type ToolsHost = {
  register: (definition: unknown) => () => void
  guard?: (fn: (exec: { name: string; agent?: { session?: { header?: { parentSession?: string; origin?: string } } } }) => string | undefined) => () => void
}

type PromptHost = {
  section: (section: { name: string; order: number; text: string }) => () => void
}

type WebServerHost = {
  register: (route: {
    kind: 'prefix' | 'exact'
    path: string
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  }) => void
}

type HostContext = {
  inject: (deps: readonly string[], callback: (ctx: {
    connection?: { rpc: RpcHandle }
    tools?: ToolsHost
    systemPrompt?: PromptHost
    webServer?: WebServerHost
  }) => void) => void
}

export function apply(ctx: HostContext): void {
  const filesBySession = new Map<string, FilesPort>()
  const pickProxy = createLocalPickProxy()
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
    browserFor: (_sessionId, io) => createHostBrowser({
      isBusy: io.isBusy,
      pickFrameUrl: (url) => pickProxyPath(url) ?? pickProxy.frameUrl(url),
    }),
    terminalFor: (_sessionId, io) => createHostTerminal(io.cwdOf),
    sideChatFor: (sessionId, io) => createHostSideChat({
      sessionId,
      files: filesBySession.get(sessionId) ?? createFsFiles(io.cwdOf),
      io,
    }),
  })
  ctx.inject(['connection'], (wired) => {
    wired.connection?.rpc.handle(
      SIDEBAR_RPC_CHANNEL,
      async (endpoint, payload) => {
        await pickProxy.ready
        return handleSidebarRpc(registry, endpoint, payload)
      },
      { authority: 'loopback' },
    )
  })
  ctx.inject(['tools'], (wired) => {
    if (wired.tools === undefined) return
    const service = createBrowserDriveService(pickProxy.drive)
    registerBrowserDriveTools(wired.tools, service, (exec) => {
      const sessionId = exec.agent?.id
      if (sessionId === undefined || sessionId.length === 0) return undefined
      return registry.forSession(sessionId, {
        cwd: exec.agent?.session?.header?.cwd ?? '',
        busy: exec.agent?.status === 'running',
      })
    }, () => pickProxy.ready)
    console.info('[dsh-codex-sidebar] browser_tabs/open/snapshot/click/fill registered')
  })
  ctx.inject(['webServer'], (wired) => {
    wired.webServer?.register({
      kind: 'prefix',
      path: '/__dcs',
      handler: (req, res) => { void pickProxy.handleHttp(req, res) },
    })
    console.info('[dsh-codex-sidebar] /__dcs pick+drive mounted on webServer')
  })
  ctx.inject(['systemPrompt'], (wired) => {
    wired.systemPrompt?.section({
      name: 'codex-sidebar:browser-drive',
      order: 140,
      text: BROWSER_DRIVE_GUIDANCE,
    })
  })
}
