/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */

import type {} from '@deepseek-ai/dsh-session'
import { SIDEBAR_RPC_CHANNEL } from './contract.ts'
import { createHostBrowser } from './host-browser.ts'
import { ManagedBrowserRuntime, type ManagedBrowserConfig } from './managed-browser-runtime.ts'
import { ManagedBrowserEvidenceStore } from './managed-browser-evidence.ts'
import { installManagedBrowserSessionLifecycle } from './managed-browser-session-lifecycle.ts'
import { ManagedBrowserStream, MANAGED_BROWSER_STREAM_PATH } from './managed-browser-stream.ts'
import { createManagedBrowserDriveService } from './host-browser-tools.ts'
import { BROWSER_DRIVE_GUIDANCE, registerBrowserDriveTools } from './register-browser-tools.ts'
import { createFsFiles } from './host-files.ts'
import { createFilePersist } from './host-persist.ts'
import { AnnotationSendStore, installAnnotationSend, type AnnotationSendHost } from './host-annotation-send.ts'
import { handleSidebarRpcAsync } from './host-rpc.ts'
import { createHostSideChat } from './host-side-chat.ts'
import { createHostTerminal } from './host-terminal.ts'
import { createRegistry } from './registry.ts'
import type { FilesPort } from './session.ts'
import { createWorkspaceInspector } from './workspace-inspector.ts'

export { createSidebarSession, PALETTE } from './session.ts'
export type {
  Annotation, AnnotationSource, Effect, FilesPort, Intent, PersistPort, SidebarSession, SidebarSnapshot, ToolKind,
} from './session.ts'
export { createRegistry } from './registry.ts'
export {
  SIDEBAR_DISPATCH_ENDPOINT,
  SIDEBAR_FILE_READ_ENDPOINT,
  SIDEBAR_RPC_CHANNEL,
  SIDEBAR_SNAPSHOT_ENDPOINT,
} from './contract.ts'
export { formatDelivery, formatEvidenceSend, formatHumanSend, formatSend } from './send-text.ts'

export const name = 'dsh-codex-sidebar'
export const inject = ['connection']

export interface Config {
  managedBrowser?: ManagedBrowserConfig
}

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
  registerUpgrade: (route: {
    path: string
    handler: (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void
  }) => () => void
}

type EffectContext = {
  effect: (callback: () => void | (() => void), label?: string) => void
}

type HostContext = EffectContext & {
  on: (
    name: 'session/disposed',
    listener: (session: { id: string }) => void,
    options: { global: true },
  ) => () => void
  inject: (deps: readonly string[], callback: (ctx: EffectContext & {
    connection?: { rpc: RpcHandle }
    tools?: ToolsHost
    systemPrompt?: PromptHost
    webServer?: WebServerHost
    agents?: { get(id: string): unknown }
    attachments?: { saveImage(input: { data: Uint8Array; mediaType: 'image/jpeg'; name?: string }): Promise<{ attachmentId: string; mediaType: 'image/jpeg'; bytes: number; width: number; height: number; name?: string }> }
  }) => void) => void
}

function agentCwd(agent: unknown): string | undefined {
  if (typeof agent !== 'object' || agent === null) return undefined
  const session = (agent as { session?: unknown }).session
  if (typeof session !== 'object' || session === null) return undefined
  const header = (session as { header?: unknown }).header
  if (typeof header !== 'object' || header === null) return undefined
  const cwd = (header as { cwd?: unknown }).cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

export function apply(ctx: HostContext, config: Config = {}): void {
  const filesBySession = new Map<string, FilesPort>()
  const annotationSend = new AnnotationSendStore()
  let agentLive = (_id: string): boolean => false
  let cwdForSession = (_id: string): string | undefined => undefined
  let saveImage: ((input: { data: Uint8Array; mediaType: 'image/jpeg'; name?: string }) => Promise<{ attachmentId: string; mediaType: 'image/jpeg'; bytes: number; width: number; height: number; name?: string }>) | undefined
  const managedBrowser = new ManagedBrowserRuntime(config.managedBrowser)
  const managedStream = new ManagedBrowserStream({
    runtime: managedBrowser,
    ...(config.managedBrowser?.desktopJpegMaxRawBytes === undefined ? {} : { desktopMaxRawBytes: config.managedBrowser.desktopJpegMaxRawBytes }),
    ...(config.managedBrowser?.mobileJpegMaxRawBytes === undefined ? {} : { mobileMaxRawBytes: config.managedBrowser.mobileJpegMaxRawBytes }),
    ...(config.managedBrowser?.desktopJpegQuality === undefined ? {} : { desktopJpegQuality: config.managedBrowser.desktopJpegQuality }),
    ...(config.managedBrowser?.desktopJpegFrameIntervalMs === undefined ? {} : { desktopJpegFrameIntervalMs: config.managedBrowser.desktopJpegFrameIntervalMs }),
    ...(config.managedBrowser?.desktopJpegMaxScale === undefined ? {} : { desktopJpegMaxScale: config.managedBrowser.desktopJpegMaxScale }),
    ...(config.managedBrowser?.desktopScreencastEveryNthFrame === undefined ? {} : { desktopScreencastEveryNthFrame: config.managedBrowser.desktopScreencastEveryNthFrame }),
    ...(config.managedBrowser?.desktopJpegInteractionBurstFrames === undefined ? {} : { desktopJpegInteractionBurstFrames: config.managedBrowser.desktopJpegInteractionBurstFrames }),
    ...(config.managedBrowser?.mobileJpegQuality === undefined ? {} : { mobileJpegQuality: config.managedBrowser.mobileJpegQuality }),
    ...(config.managedBrowser?.mobileJpegFrameIntervalMs === undefined ? {} : { mobileJpegFrameIntervalMs: config.managedBrowser.mobileJpegFrameIntervalMs }),
    ...(config.managedBrowser?.mobileJpegMaxScale === undefined ? {} : { mobileJpegMaxScale: config.managedBrowser.mobileJpegMaxScale }),
    ...(config.managedBrowser?.mobileScreencastEveryNthFrame === undefined ? {} : { mobileScreencastEveryNthFrame: config.managedBrowser.mobileScreencastEveryNthFrame }),
    ...(config.managedBrowser?.mobileJpegInteractionBurstFrames === undefined ? {} : { mobileJpegInteractionBurstFrames: config.managedBrowser.mobileJpegInteractionBurstFrames }),
    ...(config.managedBrowser?.preferredMediaRoute === undefined ? {} : { preferredMediaRoute: config.managedBrowser.preferredMediaRoute }),
    ...(config.managedBrowser?.stunUrls === undefined ? {} : { stunUrls: config.managedBrowser.stunUrls }),
    ...(config.managedBrowser?.webrtcNegotiationTimeoutMs === undefined ? {} : { webrtcNegotiationTimeoutMs: config.managedBrowser.webrtcNegotiationTimeoutMs }),
    ...(config.managedBrowser?.webrtcRetryCooldownMs === undefined ? {} : { webrtcRetryCooldownMs: config.managedBrowser.webrtcRetryCooldownMs }),
    ...(config.managedBrowser?.maxMediaPeers === undefined ? {} : { maxMediaPeers: config.managedBrowser.maxMediaPeers }),
    ...(config.managedBrowser?.maxEncoderPages === undefined ? {} : { maxEncoderPages: config.managedBrowser.maxEncoderPages }),
    ...(config.managedBrowser?.directVideoFrameRate === undefined ? {} : { directVideoFrameRate: config.managedBrowser.directVideoFrameRate }),
    ...(config.managedBrowser?.directVideoMaxBitrate === undefined ? {} : { directVideoMaxBitrate: config.managedBrowser.directVideoMaxBitrate }),
    ...(config.managedBrowser?.directVideoCaptureQuality === undefined ? {} : { directVideoCaptureQuality: config.managedBrowser.directVideoCaptureQuality }),
    ...(config.managedBrowser?.directVideoCaptureMaxScale === undefined ? {} : { directVideoCaptureMaxScale: config.managedBrowser.directVideoCaptureMaxScale }),
    ...(config.managedBrowser?.directVideoCaptureMaxRawBytes === undefined ? {} : { directVideoCaptureMaxRawBytes: config.managedBrowser.directVideoCaptureMaxRawBytes }),
    ...(config.managedBrowser?.mediaIdleTimeoutMs === undefined ? {} : { mediaIdleTimeoutMs: config.managedBrowser.mediaIdleTimeoutMs }),
    ...(config.managedBrowser?.mediaHideGraceMs === undefined ? {} : { mediaHideGraceMs: config.managedBrowser.mediaHideGraceMs }),
    ...(config.managedBrowser?.streamShutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: config.managedBrowser.streamShutdownTimeoutMs }),
  })
  const managedEvidence = new ManagedBrowserEvidenceStore(managedBrowser)
  const persist = createFilePersist()
  const workspace = createWorkspaceInspector()
  ctx.effect(() => {
    const timer = setInterval(() => { void managedBrowser.reap() }, 15_000)
    timer.unref()
    return () => {
      clearInterval(timer)
      void persist.flush()
      void Promise.all([managedStream.dispose(), managedBrowser.dispose()])
    }
  }, 'dsh-codex-sidebar: managed browser lifecycle')
  ctx.effect(
    () => installManagedBrowserSessionLifecycle(ctx, managedStream, managedBrowser, filesBySession),
    'dsh-codex-sidebar: managed browser session lifecycle',
  )
  const registry = createRegistry({
    persist,
    filesFor: (sessionId, io) => {
      const files = createFsFiles(io.cwdOf)
      filesBySession.set(sessionId, files)
      return files
    },
    browserFor: (sessionId, io) => createHostBrowser({
      isBusy: io.isBusy,
      managed: {
        runtime: managedBrowser,
        sessionId,
        closeStream: (tabId) => { managedStream.closeTab({ sessionId, tabId }) },
      },
    }),
    terminalFor: (_sessionId, io) => createHostTerminal(io.cwdOf),
    sideChatFor: (sessionId, io) => createHostSideChat({
      sessionId,
      files: filesBySession.get(sessionId) ?? createFsFiles(io.cwdOf),
      io,
    }),
  })
  ctx.inject(['webServer'], (wired) => {
    if (wired.webServer === undefined) return
    wired.effect(() => wired.webServer?.registerUpgrade({
      path: MANAGED_BROWSER_STREAM_PATH,
      handler: (req, socket, head) => { managedStream.handleUpgrade(req, socket, head) },
    }) ?? (() => {}), 'dsh-codex-sidebar: managed browser stream')
  })
  ctx.inject(['connection'], (wired) => {
    if (wired.connection === undefined) return
    wired.effect(() => wired.connection?.rpc.handle(
      SIDEBAR_RPC_CHANNEL,
      async (endpoint, payload) => {
        return handleSidebarRpcAsync(registry, endpoint, payload, {
          browserStream: managedStream,
          managedBrowser,
          browserEvidence: managedEvidence,
          annotationSend,
          cwdForSession,
          workspace,
          annotationPortsFor: (sessionId) => ({
            readFile: (path) => filesBySession.get(sessionId)?.read(path),
            ...saveImage === undefined ? {} : { saveImage },
            readEvidence: (id, evidence) => managedEvidence.read(id, evidence),
            agentLive,
          }),
        })
      },
      { authority: 'loopback' },
    ) ?? (() => {}), 'dsh-codex-sidebar: sidebar RPC')
  })
  ctx.inject(['tools'], (wired) => {
    if (wired.tools === undefined) return
    const service = createManagedBrowserDriveService(managedBrowser)
    wired.effect(() => registerBrowserDriveTools(wired.tools as ToolsHost, service, (exec) => {
      const sessionId = exec.agent?.id
      if (sessionId === undefined || sessionId.length === 0) return undefined
      return registry.forSession(sessionId, {
        cwd: exec.agent?.session?.header?.cwd ?? '',
        busy: exec.agent?.status === 'running',
      })
    }), 'dsh-codex-sidebar: Browser tools')
    console.info('[dsh-codex-sidebar] browser_tabs/open/snapshot/click/fill registered')
  })
  ctx.inject(['attachments'], (wired) => {
    if (wired.attachments === undefined) return
    saveImage = (input) => wired.attachments!.saveImage(input)
  })
  ctx.inject(['agents'], (wired) => {
    if (wired.agents === undefined) return
    agentLive = (id) => wired.agents?.get(id) !== undefined
    cwdForSession = (id) => agentCwd(wired.agents?.get(id))
    wired.effect(() => installAnnotationSend(wired as unknown as AnnotationSendHost, annotationSend), 'dsh-codex-sidebar: annotation send')
  })
  ctx.inject(['systemPrompt'], (wired) => {
    if (wired.systemPrompt === undefined) return
    wired.effect(() => wired.systemPrompt?.section({
      name: 'codex-sidebar:browser-drive',
      order: 140,
      text: BROWSER_DRIVE_GUIDANCE,
    }) ?? (() => {}), 'dsh-codex-sidebar: Browser tool guidance')
  })
}
