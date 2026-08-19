/** Document-scoped automation contract for Host-managed Browser Pages. */

export type DriveRef = string

export type DriveNode = {
  ref: DriveRef
  role: string
  name: string
  selector: string
  rect?: { x: number; y: number; w: number; h: number }
}

export type DriveSnapshot = {
  url: string
  title: string
  driveable: true
  documentId?: string
  nodes: DriveNode[]
  text: string
}

export type DriveTab = {
  tabId: string
  url: string
  title: string
  driveable: boolean
  connected: boolean
}

export type DriveErrorCode = 'not-ready' | 'stale-ref' | 'navigation-failed' | 'unknown-ref' | 'no-browser' | 'forbidden'
export type DriveFailure = { ok: false; code: DriveErrorCode; message: string }
export type DriveSuccess = { ok: true; snapshot?: DriveSnapshot }
export type DriveResult = DriveSuccess | DriveFailure

export type DriveCaller = {
  parentSession?: string
  origin?: string
}

/** Side Chat Forks and subagents do not drive the 主会话 Browser. */
export function callerMayDrive(header: DriveCaller | undefined): boolean {
  if (header === undefined) return false
  if (header.parentSession !== undefined && header.parentSession.length > 0) return false
  if (header.origin === 'subagent') return false
  return true
}

export function formatDriveTree(nodes: readonly DriveNode[], title: string): string {
  const lines = [`document "${escapeTree(title)}"`]
  for (const node of nodes) lines.push(`  ${node.role} "${escapeTree(node.name)}" [ref=${node.ref}]`)
  return lines.join('\n')
}

function escapeTree(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
}
