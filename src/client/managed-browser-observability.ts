import type { BrowserMediaPresentationRoute } from './managed-browser-stream.ts'
import { browserLayoutSurfaceSize, type ManagedBrowserLayoutCommit, type ManagedBrowserLayoutSnapshot, type ManagedBrowserSize } from './managed-browser-layout.ts'
import type { BrowserVideoPresentationSnapshot } from './managed-browser-webrtc-dom.ts'

type PresentedIdentity = Pick<ManagedBrowserLayoutCommit, 'revision' | 'mediaGeneration'>

export type BrowserPresentationObservation = {
  version: 1
  committed: ManagedBrowserLayoutCommit | null
  presented: ManagedBrowserLayoutCommit | null
  encodedSize: ManagedBrowserSize | null
  surface: ManagedBrowserSize | null
  mediaRoute: BrowserMediaPresentationRoute
  presenter:
    | { kind: 'canvas'; identity: PresentedIdentity | null }
    | { kind: 'video'; slot: 0 | 1; identity: PresentedIdentity | null; intrinsicSize: ManagedBrowserSize | null }
}

type AttributeTarget = { setAttribute(name: string, value: string): void }

/** Project non-sensitive presentation metadata without feeding media dimensions back into layout. */
export function browserPresentationObservation(
  layout: ManagedBrowserLayoutSnapshot,
  mediaRoute: BrowserMediaPresentationRoute,
  source: BrowserVideoPresentationSnapshot,
): BrowserPresentationObservation {
  const identity = layout.presented === undefined
    ? null
    : { revision: layout.presented.revision, mediaGeneration: layout.presented.mediaGeneration }
  return {
    version: 1,
    committed: layout.committed === undefined ? null : copyCommit(layout.committed),
    presented: layout.presented === undefined ? null : copyCommit(layout.presented),
    encodedSize: layout.encodedSize === undefined ? null : copySize(layout.encodedSize),
    surface: surfaceSize(layout),
    mediaRoute,
    presenter: source.presenter === 'canvas'
      ? { kind: 'canvas', identity }
      : { kind: 'video', slot: source.slot, identity, intrinsicSize: copyNullableSize(source.intrinsicSize) },
  }
}

/** Replace the complete DOM diagnostic in one attribute mutation. */
export function writeBrowserPresentationObservation(target: AttributeTarget, observation: BrowserPresentationObservation): void {
  target.setAttribute('data-browser-presentation', JSON.stringify(observation))
}

function surfaceSize(layout: ManagedBrowserLayoutSnapshot): ManagedBrowserSize | null {
  if (layout.containerSize === undefined || layout.presented === undefined) return null
  return browserLayoutSurfaceSize(layout.containerSize, layout.presented.viewport)
}

function copyCommit(commit: ManagedBrowserLayoutCommit): ManagedBrowserLayoutCommit {
  return { ...commit, viewport: copySize(commit.viewport) }
}

function copyNullableSize(size: ManagedBrowserSize | null): ManagedBrowserSize | null {
  return size === null ? null : copySize(size)
}

function copySize(size: ManagedBrowserSize): ManagedBrowserSize {
  return { width: size.width, height: size.height }
}
