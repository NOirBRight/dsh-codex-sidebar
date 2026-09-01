/**
 * Temporary alpha.1 compatibility adapter for dsh-codex-sidebar.
 *
 * DSH alpha.1 does not expose the transcript, layout, or workspace extension
 * seams needed by this client. This adapter is the approved alpha.1 exception:
 * it patches only those three surfaces and restores every patch it owns.
 *
 * The adapter never claims a takeover until the active-session dispatch returns
 * a result. Workspace and Remote calls then use the official opener when the
 * dispatch is unavailable or fails. Transcript URL listeners leave the native
 * anchor behavior untouched until a dispatch succeeds.
 */

import { isTakeoverUrl, normalizeUrl } from '../browser.ts'
import { hunkForToolRow, type ToolRowHunk } from './tool-stats.ts'
import { allowTranscriptClick, allowTranscriptTakeover } from '../transcript-takeover.ts'
import type { Intent } from '../session.ts'
import type { ClientContext } from './shim.ts'

export type CapturedToolContext = {
  lastTool?: string | undefined
  lastHunkId?: string | undefined
  lastRowHunk?: ToolRowHunk | undefined
}

export type CompatCallbacks = {
  dispatch: (sessionId: string, intent: Intent) => Promise<unknown>
  openPath: (path: string, captured: CapturedToolContext) => Promise<boolean>
  onLayoutOpen: () => void
}

type EventTargetLike = {
  addEventListener?: unknown
  removeEventListener?: unknown
}

type LayoutLike = {
  openDetails(): void
  closeDetails(): void
}

type ContextLike = {
  get?: (name: string) => unknown
  layout?: unknown
  workspaces?: unknown
  remote?: { session?: unknown }
  sessions?: {
    list?: { getSnapshot?: () => unknown }
    binding?: (sessionId: never) => unknown
  }
}

type DomElementLike = {
  closest?: unknown
  getAttribute?: unknown
  hasAttribute?: unknown
}

type InstalledPatch = {
  dispose: () => void
  patched?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function contextOf(ctx: ClientContext): ContextLike {
  return ctx as unknown as ContextLike
}

function isLayoutFace(value: unknown): value is LayoutLike {
  return isRecord(value)
    && typeof value.openDetails === 'function'
    && typeof value.closeDetails === 'function'
}

function resolveLayoutFace(ctx: ClientContext, bootLayout: unknown): LayoutLike | undefined {
  const context = contextOf(ctx)
  const current = typeof context.get === 'function' ? context.get('layout') : undefined
  if (isLayoutFace(current)) return current
  if (isLayoutFace(context.layout)) return context.layout
  return isLayoutFace(bootLayout) ? bootLayout : undefined
}

function eventTarget(value: unknown): value is EventTargetLike & {
  addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void
} {
  return isRecord(value)
    && typeof value.addEventListener === 'function'
    && typeof value.removeEventListener === 'function'
}

function addListener(
  target: unknown,
  type: string,
  listener: (event: unknown) => void,
  capture = false,
): InstalledPatch | undefined {
  if (!eventTarget(target)) return undefined
  target.addEventListener(type, listener, capture)
  let disposed = false
  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      target.removeEventListener(type, listener, capture)
    },
  }
}

function elementOf(value: unknown): DomElementLike | undefined {
  if (typeof Element !== 'undefined' && value instanceof Element) return value
  if (!isRecord(value) || typeof value.closest !== 'function') return undefined
  return value as DomElementLike
}

function closestElement(value: unknown, selector: string): DomElementLike | undefined {
  const element = elementOf(value)
  if (element === undefined || typeof element.closest !== 'function') return undefined
  const result = element.closest(selector)
  return elementOf(result)
}

function attribute(element: DomElementLike, name: string): string | undefined {
  if (typeof element.getAttribute !== 'function') return undefined
  const value = element.getAttribute(name)
  return typeof value === 'string' ? value : undefined
}

function hasAttribute(element: DomElementLike, name: string): boolean {
  return typeof element.hasAttribute === 'function' && element.hasAttribute(name)
}

function disposeReverse(disposers: readonly (() => void)[]): void {
  const failures: unknown[] = []
  for (let index = disposers.length - 1; index >= 0; index--) {
    const dispose = disposers[index]
    if (dispose === undefined) continue
    try {
      dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'alpha.1 compatibility teardown failed')
}

function restoreProperty(
  target: Record<string, unknown>,
  key: string,
  descriptor: PropertyDescriptor | undefined,
  originalValue: unknown,
  patched: unknown,
): void {
  if (target[key] !== patched) return
  if (descriptor === undefined) {
    if (!delete target[key] && target[key] === patched) throw new Error('failed to remove compatibility property ' + key)
    return
  }
  Object.defineProperty(target, key, descriptor)
  if (target[key] === patched) throw new Error('failed to restore compatibility property ' + key)
  void originalValue
}

function tryPatch(target: unknown, key: string, patched: unknown): InstalledPatch | undefined {
  if (!isRecord(target)) return undefined
  if (Object.isFrozen(target)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (descriptor !== undefined) {
    const accessor = descriptor.get !== undefined || descriptor.set !== undefined
    if (accessor && descriptor.set === undefined && descriptor.configurable !== true) return undefined
    if (!accessor && descriptor.writable !== true && descriptor.configurable !== true) return undefined
  } else if (!Object.isExtensible(target)) {
    return undefined
  }

  const originalValue = target[key]
  if (originalValue === patched) return undefined
  let installed = false
  try {
    target[key] = patched
    installed = target[key] === patched
  } catch (error) {
    if (descriptor?.configurable !== true) throw error
  }
  if (!installed && descriptor?.configurable === true) {
    Object.defineProperty(target, key, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable === true,
      value: patched,
      writable: true,
    })
    installed = target[key] === patched
  }
  if (!installed) return undefined

  let disposed = false
  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      restoreProperty(target, key, descriptor, originalValue, patched)
    },
  }
}

/**
 * Install the temporary alpha.1 Host and DOM compatibility behavior.
 * @param ctx - Client context carrying the alpha.1 services.
 * @param callbacks - Sidebar dispatch and layout callbacks.
 * @param bootLayout - Layout face captured during client setup.
 * @returns an idempotent disposer for the installed compatibility behavior.
 */
export class SidebarAlpha1CompatAdapter {
  #ctx: ClientContext
  #callbacks: CompatCallbacks
  #bootLayout: unknown
  #installed = false
  #disposers: Array<() => void> = []
  #workspaces: Record<string, unknown> | undefined
  #workspaceOriginal: ((path: string) => unknown) | undefined
  #remote: Record<string, unknown> | undefined
  #layoutPatches: Array<{ patch: InstalledPatch; target: Record<string, unknown>; patched: unknown }> = []
  #lastTool: string | undefined
  #lastHunkId: string | undefined
  #lastRowHunk: ToolRowHunk | undefined
  #openHandler: ((path: string) => Promise<boolean>) | undefined
  #urlEvents = new WeakSet<object>()

  constructor(ctx: ClientContext, callbacks: CompatCallbacks, bootLayout?: unknown) {
    this.#ctx = ctx
    this.#callbacks = callbacks
    this.#bootLayout = bootLayout
  }

  /** Install once; a later call returns a no-op disposer. */
  install(): () => void {
    if (this.#installed) return () => {}
    this.#installed = true
    try {
      this.#installToolCapture()
      this.#ensureOpenHandler()
      this.#installWorkspacesPatch()
      this.#installRemotePatch()
      this.#installUrlClicks()
      this.#installLayoutReveal()
    } catch (error) {
      try {
        this.dispose()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'alpha.1 compatibility setup failed and rollback failed')
      }
      throw error
    }
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.dispose()
    }
  }

  /** Restore every owned patch and listener in reverse installation order. */
  dispose(): void {
    if (!this.#installed && this.#disposers.length === 0) return
    this.#installed = false
    const disposers = [...this.#disposers].reverse()
    this.#disposers = []
    let failure: unknown
    try {
      disposeReverse(disposers)
    } catch (error) {
      failure = error
    } finally {
      this.#workspaces = undefined
      this.#workspaceOriginal = undefined
      this.#remote = undefined
      this.#layoutPatches = []
      this.#openHandler = undefined
      this.#lastTool = undefined
      this.#lastHunkId = undefined
      this.#lastRowHunk = undefined
    }
    if (failure !== undefined) throw failure
  }

  /**
   * Open a decorated transcript path, falling back to the official workspace opener.
   * @param path - Transcript path or URL.
   * @returns true for a Sidebar takeover and false after official fallback.
   */
  tryOpenTranscriptPath(path: string): Promise<boolean> | undefined {
    if (!this.#installed || this.#openHandler === undefined) return undefined
    return this.#openHandler(path)
  }

  /** Retry layout patching after alpha.1 replaces the layout face. */
  ensureLayoutPatched(): void {
    if (!this.#installed) return
    this.#installLayoutReveal()
  }

  #captureToolContext(target: unknown): void {
    const host = closestElement(target, '[data-tool]')
    if (host === undefined) {
      this.#lastTool = undefined
      this.#lastHunkId = undefined
      this.#lastRowHunk = undefined
      return
    }
    this.#lastTool = attribute(host, 'data-tool')
    if (typeof HTMLElement !== 'undefined' && host instanceof HTMLElement) {
      this.#lastHunkId = host.dataset.dcsHunkId
      this.#lastRowHunk = hunkForToolRow(host)
    } else {
      this.#lastHunkId = undefined
      this.#lastRowHunk = undefined
    }
  }

  #consumeCaptured(): CapturedToolContext {
    const out: CapturedToolContext = {
      lastTool: this.#lastTool,
      lastHunkId: this.#lastHunkId,
      lastRowHunk: this.#lastRowHunk,
    }
    this.#lastTool = undefined
    this.#lastHunkId = undefined
    this.#lastRowHunk = undefined
    return out
  }

  #installToolCapture(): void {
    if (typeof document === 'undefined' || !eventTarget(document)) return
    const pointerHandler = (event: unknown): void => {
      this.#captureToolContext(isRecord(event) ? event.target : undefined)
    }
    const clickHandler = (event: unknown): void => {
      this.#captureToolContext(isRecord(event) ? event.target : undefined)
    }
    const pointer = addListener(document, 'pointerdown', pointerHandler, true)
    if (pointer !== undefined) this.#disposers.push(pointer.dispose)
    const click = addListener(document, 'click', clickHandler, true)
    if (click !== undefined) this.#disposers.push(click.dispose)
  }

  #ensureOpenHandler(): void {
    if (this.#openHandler !== undefined) return
    const context = contextOf(this.#ctx)
    const workspaces = isRecord(context.workspaces) ? context.workspaces : undefined
    this.#workspaces = workspaces
    const original = workspaces?.openPath
    this.#workspaceOriginal = typeof original === 'function'
      ? (path: string): unknown => original.call(workspaces, path)
      : undefined
    this.#openHandler = async (path: string): Promise<boolean> => {
      let adapterError: unknown
      try {
        if (await this.#tryOpenInSidebar(path)) return true
      } catch (error) {
        adapterError = error
      }
      try {
        await this.#callOfficialWorkspacePath(path)
        return false
      } catch (officialError) {
        if (adapterError === undefined) throw officialError
        throw new AggregateError([officialError, adapterError], 'alpha.1 path takeover and official fallback failed')
      }
    }
  }

  async #callOfficialWorkspacePath(path: string): Promise<void> {
    const context = contextOf(this.#ctx)
    const current = isRecord(context.workspaces) ? context.workspaces : undefined
    const currentOpen = current?.openPath
    if (typeof currentOpen === 'function' && current !== this.#workspaces && currentOpen !== this.#openHandler) {
      await currentOpen.call(current, path)
      return
    }
    if (this.#workspaceOriginal !== undefined) {
      await this.#workspaceOriginal(path)
    }
  }

  #activeSessionId(): string | undefined {
    const sessions = contextOf(this.#ctx).sessions
    const list = sessions?.list
    if (sessions === undefined || list === undefined || typeof list.getSnapshot !== 'function' || typeof sessions.binding !== 'function') return undefined
    const snapshot = list.getSnapshot()
    if (!isRecord(snapshot)) return undefined
    const current = snapshot.current
    if (current === undefined || !isRecord(snapshot.byId) || snapshot.byId[String(current)] === undefined) return undefined
    const binding = sessions.binding(current as never)
    return binding === undefined ? undefined : String(current)
  }

  async #tryOpenInSidebar(path: string): Promise<boolean> {
    const sessionId = this.#activeSessionId()
    if (sessionId === undefined) return false
    if (isTakeoverUrl(path)) {
      const result = await this.#callbacks.dispatch(sessionId, { type: 'open-url', url: normalizeUrl(path) })
      return result !== undefined
    }
    return this.#callbacks.openPath(path, this.#consumeCaptured())
  }

  #installWorkspacesPatch(): void {
    const workspaces = this.#workspaces
    if (workspaces === undefined || typeof workspaces.openPath !== 'function') return
    if (this.#openHandler === undefined) this.#ensureOpenHandler()
    const patched = this.#openHandler
    if (patched === undefined || workspaces.openPath === patched) return
    const patch = tryPatch(workspaces, 'openPath', patched)
    if (patch === undefined) return
    this.#disposers.push(patch.dispose)
  }

  #installRemotePatch(): void {
    const remoteSession = contextOf(this.#ctx).remote?.session
    if (!isRecord(remoteSession) || typeof remoteSession.openWorkspacePath !== 'function') return
    if (this.#remote === remoteSession) return
    this.#remote = remoteSession
    const original = remoteSession.openWorkspacePath
    const originalBound = (request: unknown, signal?: unknown): unknown => original.call(remoteSession, request, signal)
    const wrapped = async (request: unknown, signal?: unknown): Promise<unknown> => {
      const path = isRecord(request) && typeof request.path === 'string' ? request.path : undefined
      if (path === undefined || path.length === 0) return originalBound(request, signal)
      const current = contextOf(this.#ctx).remote?.session
      if (current !== remoteSession) return originalBound(request, signal)
      let adapterError: unknown
      try {
        if (await this.#tryOpenInSidebar(path)) return { ok: true, value: { opened: true } }
      } catch (error) {
        adapterError = error
      }
      try {
        return await originalBound(request, signal)
      } catch (officialError) {
        if (adapterError === undefined) throw officialError
        throw new AggregateError([officialError, adapterError], 'alpha.1 Remote takeover and official fallback failed')
      }
    }
    const patch = tryPatch(remoteSession, 'openWorkspacePath', wrapped)
    if (patch === undefined) return
    this.#disposers.push(patch.dispose)
  }

  #installUrlClicks(): void {
    if (typeof document === 'undefined') return
    const onClick = (event: unknown): void => {
      if (!isRecord(event)) return
      const preventDefault = event.preventDefault
      const stopPropagation = event.stopPropagation
      if (typeof preventDefault !== 'function' || typeof stopPropagation !== 'function') return
      const node = closestElement(event.target, 'a')
      if (node === undefined) return
      const explicit = hasAttribute(node, 'data-dcs-url')
      const click = {
        defaultPrevented: event.defaultPrevented === true,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        altKey: event.altKey === true,
      }
      if (!allowTranscriptClick(click, explicit)) return
      if (!allowTranscriptTakeover((selector) => {
        if (typeof node.closest !== 'function') return undefined
        return node.closest(selector)
      })) return
      const href = (attribute(node, 'data-dcs-url') ?? attribute(node, 'href') ?? '').trim()
      if (!isTakeoverUrl(href)) return
      if (typeof event !== 'object' || event === null) return
      if (this.#urlEvents.has(event)) return
      const sessionId = this.#activeSessionId()
      if (sessionId === undefined) return
      this.#urlEvents.add(event)
      const attempt = this.#callbacks.dispatch(sessionId, { type: 'open-url', url: normalizeUrl(href) })
      void attempt.then((result) => {
        if (result === undefined) return
        preventDefault.call(event)
        stopPropagation.call(event)
      })
    }
    const roots = new Set<unknown>()
    if (typeof window !== 'undefined') roots.add(window)
    roots.add(document)
    for (const root of roots) {
      const listener = addListener(root, 'click', onClick, true)
      if (listener !== undefined) this.#disposers.push(listener.dispose)
    }
  }

  #installLayoutReveal(): void {
    const layout = resolveLayoutFace(this.#ctx, this.#bootLayout)
    if (layout === undefined) return
    const target = layout as unknown as Record<string, unknown>
    for (const entry of this.#layoutPatches) {
      if (entry.target === target && target.openDetails === entry.patched) return
    }
    const original = target.openDetails
    if (typeof original !== 'function') return
    const originalBound = original.bind(layout)
    const wrapped = (): void => {
      originalBound()
      this.#callbacks.onLayoutOpen()
    }
    const patch = tryPatch(target, 'openDetails', wrapped)
    if (patch === undefined) return
    const entry = { patch, target, patched: wrapped }
    this.#layoutPatches.push(entry)
    this.#disposers.push(() => {
      patch.dispose()
      this.#layoutPatches = this.#layoutPatches.filter((current) => current !== entry)
    })
  }
}
