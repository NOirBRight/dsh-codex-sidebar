/** Temporary Browser captures and draft screenshot evidence sidecars. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { DriveNode } from './browser-drive.ts'
import type { ManagedBrowserCapture, ManagedBrowserRuntime, ManagedTabKey } from './managed-browser-runtime.ts'
import type { BrowserLayout } from './managed-browser-protocol.ts'
import type { BrowserEvidence } from './session.ts'

const TEMP_CAPTURE_TTL_MS = 10 * 60_000
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024

export type BrowserCaptureMetadata = {
  captureId: string
  documentId: string
  layoutRevision: number
  mediaGeneration: number
  url: string
  title: string
  mediaType: 'image/jpeg'
  width: number
  height: number
  nodes: DriveNode[]
}

type TemporaryCapture = {
  tab: ManagedTabKey
  capture: ManagedBrowserCapture
  expiresAt: number
}

export class ManagedBrowserEvidenceStore {
  readonly root: string
  #runtime: ManagedBrowserRuntime
  #now: () => number
  #captures = new Map<string, TemporaryCapture>()
  #committed = new Map<string, { sessionId: string; evidence: BrowserEvidence }>()

  constructor(runtime: ManagedBrowserRuntime, opts: { root?: string; now?: () => number } = {}) {
    this.#runtime = runtime
    this.#now = opts.now ?? Date.now
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    this.root = resolve(opts.root ?? join(dshHome, 'codex-sidebar', 'draft-evidence'))
  }

  async capture(tab: ManagedTabKey, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserCaptureMetadata> {
    this.#pruneTemporary()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.#runtime.capture(tab, expected)
      if (!('captureId' in result)) {
        throw new Error(result.ok ? 'Browser capture returned no image' : result.message)
      }
      if (!sameCaptureIdentity(this.#runtime.captureIdentity(tab), result)) continue
      if (result.image.byteLength > MAX_EVIDENCE_BYTES) throw new Error('Browser screenshot exceeds the 5 MB attachment limit')
      this.#captures.set(result.captureId, { tab, capture: result, expiresAt: this.#now() + TEMP_CAPTURE_TTL_MS })
      return metadata(result)
    }
    throw new Error('Browser navigated while capturing evidence; try again')
  }

  async commit(sessionId: string, captureId: string, expected: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>): Promise<BrowserEvidence> {
    this.#pruneTemporary()
    const committed = this.#committed.get(captureId)
    if (committed !== undefined) {
      if (committed.sessionId !== sessionId) throw new Error('Browser capture belongs to a different session')
      if (committed.evidence.layoutRevision !== expected.revision || committed.evidence.mediaGeneration !== expected.mediaGeneration) {
        throw new Error('Browser capture layout identity is stale')
      }
      return committed.evidence
    }
    const temporary = this.#captures.get(captureId)
    if (temporary === undefined || temporary.tab.sessionId !== sessionId) throw new Error('Browser capture is missing or expired')
    const capture = temporary.capture
    if (capture.layoutRevision !== expected.revision || capture.mediaGeneration !== expected.mediaGeneration
      || !sameCaptureIdentity(this.#runtime.captureIdentity(temporary.tab), capture)) {
      this.#captures.delete(captureId)
      throw new Error('Browser capture is stale after navigation or layout change')
    }
    const id = createHash('sha256').update(capture.image).digest('hex').slice(0, 32)
    const sessionDir = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
    const ref = sessionDir + '/' + id + '.jpg'
    const finalPath = this.#path(ref)
    const tempPath = finalPath + '.tmp-' + process.pid + '-' + Date.now()
    await mkdir(resolve(this.root, sessionDir), { recursive: true, mode: 0o700 })
    await writeFile(tempPath, capture.image, { mode: 0o600 })
    if (!sameCaptureIdentity(this.#runtime.captureIdentity(temporary.tab), capture)) {
      await rm(tempPath, { force: true })
      this.#captures.delete(captureId)
      throw new Error('Browser capture is stale after navigation or layout change')
    }
    await rename(tempPath, finalPath).catch(async (error: unknown) => {
      await rm(tempPath, { force: true })
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    this.#captures.delete(captureId)
    if (!sameCaptureIdentity(this.#runtime.captureIdentity(temporary.tab), capture)) {
      throw new Error('Browser capture is stale after navigation or layout change')
    }
    const evidence: BrowserEvidence = {
      id,
      captureId,
      documentId: capture.documentId,
      layoutRevision: capture.layoutRevision,
      mediaGeneration: capture.mediaGeneration,
      ref,
      mediaType: capture.mediaType,
      width: capture.width,
      height: capture.height,
    }
    this.#committed.set(captureId, { sessionId, evidence })
    return evidence
  }

  async read(sessionId: string, evidence: BrowserEvidence): Promise<{ mediaType: 'image/jpeg'; data: string }> {
    const sessionDir = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
    if (!evidence.ref.startsWith(sessionDir + '/')) throw new Error('Browser evidence belongs to a different session')
    const bytes = await readFile(this.#path(evidence.ref))
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error('Stored Browser screenshot exceeds the 5 MB attachment limit')
    return { mediaType: 'image/jpeg', data: bytes.toString('base64') }
  }

  discard(captureId: string): void {
    this.#captures.delete(captureId)
  }

  async remove(evidence: BrowserEvidence): Promise<void> {
    await rm(this.#path(evidence.ref), { force: true })
  }

  #path(ref: string): string {
    if (!/^[a-f0-9]{20}\/[a-f0-9]{32}\.jpg$/.test(ref)) throw new Error('Invalid Browser evidence ref')
    const path = resolve(this.root, ref)
    if (!path.startsWith(this.root + sep)) throw new Error('Browser evidence path escaped its root')
    return path
  }

  #pruneTemporary(): void {
    const now = this.#now()
    for (const [id, item] of this.#captures) if (item.expiresAt < now) this.#captures.delete(id)
  }
}

function metadata(capture: ManagedBrowserCapture): BrowserCaptureMetadata {
  return {
    captureId: capture.captureId,
    documentId: capture.documentId,
    layoutRevision: capture.layoutRevision,
    mediaGeneration: capture.mediaGeneration,
    url: capture.url,
    title: capture.title,
    mediaType: capture.mediaType,
    width: capture.width,
    height: capture.height,
    nodes: capture.nodes,
  }
}

function sameCaptureIdentity(
  current: { documentId: string; layoutRevision: number; mediaGeneration: number } | undefined,
  capture: Pick<ManagedBrowserCapture, 'documentId' | 'layoutRevision' | 'mediaGeneration'>,
): boolean {
  return current !== undefined && current.documentId === capture.documentId
    && current.layoutRevision === capture.layoutRevision && current.mediaGeneration === capture.mediaGeneration
}
