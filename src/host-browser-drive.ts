/** In-process queue between agent tools and a loopback iframe guest. */

import { sameDriveUrl, type DriveResult, type DriveSnapshot } from './browser-drive.ts'

export type DriveRequest =
  | { type: 'snapshot' }
  | { type: 'click'; ref: string }
  | { type: 'fill'; ref: string; text: string }

export type DriveCommand = DriveRequest & { id: string }

export type DriveHub = {
  wait(url: string): Promise<DriveCommand | null>
  cancelWait(url: string): void
  reply(id: string, result: DriveResult): void
  send(url: string, request: DriveRequest, opts?: { timeoutMs?: number }): Promise<DriveResult>
  connected(url: string): boolean
  connectedUrls(): string[]
}

type Waiter = {
  url: string
  resolve: (cmd: DriveCommand | null) => void
}

type Pending = {
  url: string
  cmd: DriveCommand
  resolve: (result: DriveResult) => void
  timer: ReturnType<typeof setTimeout>
}

export function createDriveHub(): DriveHub {
  const waiters: Waiter[] = []
  const pendings: Pending[] = []
  let seq = 0

  function connected(url: string): boolean {
    return waiters.some((item) => sameDriveUrl(item.url, url))
      || pendings.some((item) => sameDriveUrl(item.url, url))
  }

  return {
    connected,
    connectedUrls() {
      const urls: string[] = []
      for (const item of waiters) {
        if (!urls.some((url) => sameDriveUrl(url, item.url))) urls.push(item.url)
      }
      for (const item of pendings) {
        if (!urls.some((url) => sameDriveUrl(url, item.url))) urls.push(item.url)
      }
      return urls
    },
    wait(url) {
      const queued = pendings.find((item) => sameDriveUrl(item.url, url))
      if (queued !== undefined) return Promise.resolve(queued.cmd)
      return new Promise((resolve) => {
        waiters.push({ url, resolve })
      })
    },
    cancelWait(url) {
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const item = waiters[i]
        if (item === undefined || !sameDriveUrl(item.url, url)) continue
        waiters.splice(i, 1)
        item.resolve(null)
      }
    },
    reply(id, result) {
      const index = pendings.findIndex((item) => item.cmd.id === id)
      if (index < 0) return
      const item = pendings[index]
      if (item === undefined) return
      pendings.splice(index, 1)
      clearTimeout(item.timer)
      item.resolve(result)
    },
    send(url, request, opts) {
      const timeoutMs = opts?.timeoutMs ?? 15_000
      const cmd: DriveCommand = { ...request, id: 'd' + String(seq += 1) }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = pendings.findIndex((item) => item.cmd.id === cmd.id)
          if (index >= 0) pendings.splice(index, 1)
          resolve({
            ok: false,
            code: 'not-connected',
            message: '侧栏里的页面还没接上，先打开 Browser Tab 并等它加载完',
          })
        }, timeoutMs)
        pendings.push({ url, cmd, resolve, timer })
        const waiterIndex = waiters.findIndex((item) => sameDriveUrl(item.url, url))
        if (waiterIndex < 0) return
        const waiter = waiters[waiterIndex]
        waiters.splice(waiterIndex, 1)
        waiter?.resolve(cmd)
      })
    },
  }
}

export function snapshotFromUnknown(value: unknown): DriveSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const rec = value as Record<string, unknown>
  if (typeof rec.url !== 'string' || typeof rec.title !== 'string' || typeof rec.text !== 'string') {
    return undefined
  }
  if (!Array.isArray(rec.nodes)) return undefined
  const nodes = rec.nodes.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const node = item as Record<string, unknown>
    if (typeof node.ref !== 'string' || typeof node.role !== 'string') return []
    if (typeof node.name !== 'string' || typeof node.selector !== 'string') return []
    return [{ ref: node.ref, role: node.role, name: node.name, selector: node.selector }]
  })
  return { url: rec.url, title: rec.title, driveable: true, nodes, text: rec.text }
}
