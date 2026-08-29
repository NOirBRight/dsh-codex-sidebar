import type { BrowserMediaPresentationRoute } from './managed-browser-stream.ts'
import { browserLayoutSurfaceSize, type ManagedBrowserLayoutCommit, type ManagedBrowserLayoutSnapshot, type ManagedBrowserSize } from './managed-browser-layout.ts'
import type { BrowserVideoPresentationSnapshot } from './managed-browser-webrtc-dom.ts'
import type { BrowserMediaIdentity } from '../managed-browser-protocol.ts'

type AttributeTarget = { setAttribute(name: string, value: string): void }

/** Browser control-connection state reported by presentation diagnostics. */
export type BrowserPresentationConnection = 'connecting' | 'connected' | 'disconnected'

/** Exact visible presenter, including the identity accepted by its own media path. */
export type BrowserPresentationSource =
  | Extract<BrowserVideoPresentationSnapshot, { presenter: 'video' }>
  | { presenter: 'canvas'; identity: BrowserMediaIdentity | null }
  | { presenter: 'none' }

/** Complete input used for one atomic Browser presentation observation. */
export type BrowserPresentationState = {
  connection: BrowserPresentationConnection
  ownerId: string | null
  layout: ManagedBrowserLayoutSnapshot | null
  mediaRoute: BrowserMediaPresentationRoute
  source: BrowserPresentationSource
}

/** Non-sensitive presentation metadata exposed on the Browser surface. */
export type BrowserPresentationObservation = {
  version: 1
  connection: BrowserPresentationConnection
  committed: ManagedBrowserLayoutCommit | null
  presented: ManagedBrowserLayoutCommit | null
  encodedSize: ManagedBrowserSize | null
  surface: ManagedBrowserSize | null
  mediaRoute: BrowserMediaPresentationRoute
  presenter:
    | { kind: 'none' }
    | { kind: 'canvas'; identity: BrowserMediaIdentity | null }
    | { kind: 'video'; slot: 0 | 1; identity: BrowserMediaIdentity; intrinsicSize: ManagedBrowserSize | null }
}

/** Publish one complete non-sensitive presentation state with a single DOM mutation; defer direct route diagnostics until its current video is presented. */
export function publishBrowserPresentation(
  target: AttributeTarget | undefined,
  state: BrowserPresentationState,
): BrowserPresentationObservation | undefined {
  if (!coherentDirectPresentation(state)) return undefined
  const observation = browserPresentationObservation(state)
  target?.setAttribute('data-browser-presentation', JSON.stringify(observation))
  return observation
}

function coherentDirectPresentation(state: BrowserPresentationState): boolean {
  if (state.connection !== 'connected' || state.mediaRoute !== 'direct-video') return true
  const committed = state.layout?.committed
  const presented = state.layout?.presented
  return state.source.presenter === 'video'
    && state.ownerId !== null
    && committed !== undefined
    && presented !== undefined
    && state.source.identity.ownerId === state.ownerId
    && state.source.identity.revision === committed.revision
    && state.source.identity.mediaGeneration === committed.mediaGeneration
    && committed.revision === presented.revision
    && committed.mediaGeneration === presented.mediaGeneration
}

function browserPresentationObservation(state: BrowserPresentationState): BrowserPresentationObservation {
  if (state.connection !== 'connected' || state.layout === null) {
    return {
      version: 1,
      connection: state.connection,
      committed: null,
      presented: null,
      encodedSize: null,
      surface: null,
      mediaRoute: state.mediaRoute,
      presenter: { kind: 'none' },
    }
  }
  const layout = state.layout
  return {
    version: 1,
    connection: state.connection,
    committed: layout.committed === undefined ? null : copyCommit(layout.committed),
    presented: layout.presented === undefined ? null : copyCommit(layout.presented),
    encodedSize: layout.encodedSize === undefined ? null : copySize(layout.encodedSize),
    surface: surfaceSize(layout),
    mediaRoute: state.mediaRoute,
    presenter: state.source.presenter === 'none'
      ? { kind: 'none' }
      : state.source.presenter === 'canvas'
        ? { kind: 'canvas', identity: copyNullableIdentity(state.source.identity) }
        : { kind: 'video', slot: state.source.slot, identity: copyIdentity(state.source.identity), intrinsicSize: copyNullableSize(state.source.intrinsicSize) },
  }
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

function copyNullableIdentity(identity: BrowserMediaIdentity | null): BrowserMediaIdentity | null {
  return identity === null ? null : copyIdentity(identity)
}

function copyIdentity(identity: BrowserMediaIdentity): BrowserMediaIdentity {
  return { ownerId: identity.ownerId, revision: identity.revision, mediaGeneration: identity.mediaGeneration }
}

function copySize(size: ManagedBrowserSize): ManagedBrowserSize {
  return { width: size.width, height: size.height }
}
