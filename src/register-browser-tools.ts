/** Register 主会话 Browser drive tools. */

import { callerMayDrive, type DriveCaller } from './browser-drive.ts'
import { BROWSER_DRIVE_TOOLS, type BrowserDriveService } from './host-browser-tools.ts'
import type { SidebarSession } from './session.ts'

type DriveResultish = { ok: false; code: string; message: string }

type DriveExec = {
  agent?: {
    id?: string
    status?: string
    session?: { header?: DriveCaller & { cwd?: string } }
  }
}

export type ToolsHost = {
  register(definition: unknown): () => void
  guard?(fn: (exec: { name: string; agent?: { session?: { header?: DriveCaller } } }) => string | undefined): () => void
}

export const BROWSER_DRIVE_GUIDANCE = [
  '侧栏 Browser 是当前主会话的托管 Chromium，用人的同一只 Tab，支持本机和公网站。',
  '操作它只用 browser_tabs / browser_open / browser_snapshot / browser_click / browser_fill。',
  '不要用 computer-use、Orca、桌面截图、系统 Chrome，也不要用 bash sleep / 提权沙箱来等页面。',
  'browser_open 会静默打开，不必先拉开侧栏；随后 browser_snapshot 获取当前 document-scoped ref。',
  '页面导航后旧 ref 会失效，重新 snapshot。Side Chat / Fork 不能用这组工具。',
].join('\n')

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: { ok: { type: 'boolean' } },
}

export function registerBrowserDriveTools(
  tools: ToolsHost,
  service: BrowserDriveService,
  sessionOf: (exec: DriveExec) => SidebarSession | undefined,
  before?: () => Promise<void>,
): () => void {
  const disposers: Array<() => void> = []
  const render = (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]

  function tool(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    execute: (args: Record<string, unknown>, exec: DriveExec) => Promise<unknown>,
  ): void {
    disposers.push(tools.register({
      name,
      description,
      parameters,
      output: { schema: RESULT_SCHEMA, render },
      isConcurrencySafe: name === 'browser_tabs' ? () => true : undefined,
      execute,
    }))
  }

  tool(
    'browser_tabs',
    '列出当前主会话侧栏 Browser Tab。操作托管页面必须用这组 browser_* 工具，禁止 computer-use / Orca / 桌面截图。Fork / Side Chat 不能用。',
    { type: 'object', properties: {}, additionalProperties: false },
    async (_args, exec) => {
      await before?.()
      const session = sessionOf(exec)
      if (session === undefined) return missingSession()
      return service.tabs(headerOf(exec), session)
    },
  )

  tool(
    'browser_open',
    '在侧栏托管 Browser 打开本机或公网 URL（静默，不必拉开侧栏），随后可 snapshot/click/fill。禁止用 computer-use 代替。',
    {
      type: 'object',
      additionalProperties: false,
      properties: { url: { type: 'string', description: '要打开的地址' } },
      required: ['url'],
    },
    async (args, exec) => {
      await before?.()
      const session = sessionOf(exec)
      if (session === undefined) return missingSession()
      return service.open(headerOf(exec), session, String(args.url ?? ''))
    },
  )

  tool(
    'browser_snapshot',
    '读取侧栏托管页面的可交互树，返回 document-scoped ref。open 之后直接调用本工具，它会等待连接。禁止 sleep、禁止 computer-use。',
    {
      type: 'object',
      additionalProperties: false,
      properties: { tabId: { type: 'string', description: 'Browser Tab id，省略则用当前 Tab' } },
    },
    async (args, exec) => {
      await before?.()
      const session = sessionOf(exec)
      if (session === undefined) return missingSession()
      return service.snapshot(headerOf(exec), session, optionalString(args.tabId))
    },
  )

  tool(
    'browser_click',
    '点击最近一次 browser_snapshot 的 document-scoped ref。导航后需重新 snapshot。禁止 computer-use。',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: { type: 'string', description: 'snapshot 里的 @eN' },
        tabId: { type: 'string', description: 'Browser Tab id' },
      },
      required: ['ref'],
    },
    async (args, exec) => {
      await before?.()
      const session = sessionOf(exec)
      if (session === undefined) return missingSession()
      return service.click(headerOf(exec), session, String(args.ref ?? ''), optionalString(args.tabId))
    },
  )

  tool(
    'browser_fill',
    '向最近一次 snapshot 的输入框 ref 填文本；导航后需重新 snapshot。禁止 computer-use 打字。',
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: { type: 'string', description: 'snapshot 里的 @eN' },
        text: { type: 'string', description: '要填入的文本' },
        tabId: { type: 'string', description: 'Browser Tab id' },
      },
      required: ['ref', 'text'],
    },
    async (args, exec) => {
      await before?.()
      const session = sessionOf(exec)
      if (session === undefined) return missingSession()
      return service.fill(headerOf(exec), session, String(args.ref ?? ''), String(args.text ?? ''), optionalString(args.tabId))
    },
  )

  const disposeGuard = tools.guard?.((exec) => {
    if (!(BROWSER_DRIVE_TOOLS as readonly string[]).includes(exec.name)) return undefined
    if (callerMayDrive(exec.agent?.session?.header)) return undefined
    return '只有当前主会话的舵主能操作侧栏 Browser'
  })
  if (disposeGuard !== undefined) disposers.push(disposeGuard)
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function headerOf(exec: { agent?: { session?: { header?: DriveCaller } } }): DriveCaller | undefined {
  return exec.agent?.session?.header
}

function missingSession(): DriveResultish {
  return { ok: false, code: 'no-browser', message: '没有当前主会话，无法操作侧栏 Browser' }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
