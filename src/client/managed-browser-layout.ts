import { browserDeviceViewport, type BrowserDevice } from '../browser.ts'

export type ManagedBrowserSize = { width: number; height: number }
export type ManagedBrowserLayoutMode = BrowserDevice

export type ManagedBrowserLayoutCommit = {
  revision: number
  mode: ManagedBrowserLayoutMode
  viewport: ManagedBrowserSize
  mediaGeneration: number
}

export type ManagedBrowserLayoutFrame = {
  revision: number
  mediaGeneration: number
  viewport: ManagedBrowserSize
  encodedSize: ManagedBrowserSize
  /** Diagnostic CDP device dimensions; never presentation geometry. */
  deviceSize?: ManagedBrowserSize
}

export type ManagedBrowserLayoutProposal = {
  proposalSequence: number
  mode: ManagedBrowserLayoutMode
  viewport: ManagedBrowserSize
}

export type ManagedBrowserLayoutClientOptions = {
  mode: ManagedBrowserLayoutMode
  settleMs: number
  hysteresisPx: number
  viewportLimits: { min: ManagedBrowserSize; max: ManagedBrowserSize }
}

export type ManagedBrowserLayoutSnapshot = {
  mode: ManagedBrowserLayoutMode
  containerSize?: ManagedBrowserSize
  committed?: ManagedBrowserLayoutCommit
  presented?: ManagedBrowserLayoutCommit
  encodedSize?: ManagedBrowserSize
  inputHeld: boolean
}

type SurfaceBounds = { x: number; y: number; width: number; height: number }

/** Client-side projection of Host-authoritative Browser layout and presentation. */
export class ManagedBrowserLayoutClient {
  #mode: ManagedBrowserLayoutMode
  #settleMs: number
  #hysteresisPx: number
  #viewportLimits: ManagedBrowserLayoutClientOptions['viewportLimits']
  #containerSize: ManagedBrowserSize | undefined
  #committed: ManagedBrowserLayoutCommit | undefined
  #presented: ManagedBrowserLayoutCommit | undefined
  #encodedSize: ManagedBrowserSize | undefined
  #proposalSequence = 0
  #pendingFit: { viewport: ManagedBrowserSize; stableSince: number } | undefined
  #lastProposedViewport: ManagedBrowserSize | undefined
  #imeVisible = false

  constructor(options: ManagedBrowserLayoutClientOptions) {
    this.#mode = options.mode
    this.#settleMs = finiteNonnegative(options.settleMs, 'settleMs')
    this.#hysteresisPx = finiteNonnegative(options.hysteresisPx, 'hysteresisPx')
    if (!validSize(options.viewportLimits.min) || !validSize(options.viewportLimits.max)
      || options.viewportLimits.min.width > options.viewportLimits.max.width
      || options.viewportLimits.min.height > options.viewportLimits.max.height) {
      throw new Error('Managed Browser viewport limits are invalid')
    }
    this.#viewportLimits = {
      min: copySize(options.viewportLimits.min),
      max: copySize(options.viewportLimits.max),
    }
  }

  observeContainer(size: ManagedBrowserSize, observedAt: number): void {
    if (!validSize(size) || !Number.isFinite(observedAt)) return
    this.#containerSize = copySize(size)
    if (this.#mode !== 'fit') {
      this.#pendingFit = undefined
      return
    }
    const viewport = this.#fitViewport(size)
    if (this.#lastProposedViewport !== undefined && nearSize(viewport, this.#lastProposedViewport, this.#hysteresisPx)) {
      this.#pendingFit = undefined
      return
    }
    const pending = this.#pendingFit
    this.#pendingFit = pending !== undefined && nearSize(viewport, pending.viewport, this.#hysteresisPx)
      ? { viewport, stableSince: pending.stableSince }
      : { viewport, stableSince: observedAt }
  }

  selectMode(mode: ManagedBrowserLayoutMode, selectedAt: number): ManagedBrowserLayoutProposal | undefined {
    this.#mode = mode
    this.#pendingFit = undefined
    this.#lastProposedViewport = undefined
    const viewport = browserDeviceViewport(mode)
    if (viewport !== null) return this.#proposal(mode, viewport)
    if (this.#containerSize !== undefined && Number.isFinite(selectedAt)) {
      this.#pendingFit = { viewport: this.#fitViewport(this.#containerSize), stableSince: selectedAt }
    }
    return undefined
  }

  setImeVisible(visible: boolean, changedAt: number): void {
    if (visible === this.#imeVisible) return
    this.#imeVisible = visible
    if (!visible && this.#mode === 'fit' && this.#containerSize !== undefined && Number.isFinite(changedAt)) {
      this.#pendingFit = { viewport: this.#fitViewport(this.#containerSize), stableSince: changedAt }
    }
  }

  proposalDueAt(): number | undefined {
    return this.#mode === 'fit' && !this.#imeVisible && this.#pendingFit !== undefined
      ? this.#pendingFit.stableSince + this.#settleMs
      : undefined
  }

  pollProposal(now: number): ManagedBrowserLayoutProposal | undefined {
    const pending = this.#pendingFit
    if (this.#mode !== 'fit' || this.#imeVisible || pending === undefined || !Number.isFinite(now) || now - pending.stableSince < this.#settleMs) return undefined
    this.#pendingFit = undefined
    if (this.#lastProposedViewport !== undefined && nearSize(pending.viewport, this.#lastProposedViewport, this.#hysteresisPx)) return undefined
    this.#lastProposedViewport = copySize(pending.viewport)
    return this.#proposal('fit', pending.viewport)
  }

  acceptCommit(commit: ManagedBrowserLayoutCommit): boolean {
    if (!validCommit(commit)
      || commit.revision <= (this.#committed?.revision ?? 0)
      || commit.mediaGeneration <= (this.#committed?.mediaGeneration ?? 0)) return false
    this.#committed = copyCommit(commit)
    if (commit.mode === 'fit' && this.#mode === 'fit') {
      this.#lastProposedViewport = copySize(commit.viewport)
      if (this.#pendingFit !== undefined && nearSize(this.#pendingFit.viewport, commit.viewport, this.#hysteresisPx)) {
        this.#pendingFit = undefined
      }
    } else if (this.#mode !== 'fit') {
      this.#pendingFit = undefined
      this.#lastProposedViewport = undefined
    }
    return true
  }

  acceptFrame(frame: ManagedBrowserLayoutFrame): { accepted: boolean; switched: boolean } {
    const committed = this.#committed
    if (committed === undefined
      || frame.revision !== committed.revision
      || frame.mediaGeneration !== committed.mediaGeneration
      || !sameSize(frame.viewport, committed.viewport)
      || !validSize(frame.encodedSize)) {
      return { accepted: false, switched: false }
    }
    const switched = this.#presented?.revision !== committed.revision
      || this.#presented.mediaGeneration !== committed.mediaGeneration
    this.#presented = copyCommit(committed)
    this.#encodedSize = copySize(frame.encodedSize)
    return { accepted: true, switched }
  }

  inputHeld(): boolean {
    return this.#committed === undefined
      || this.#presented?.revision !== this.#committed.revision
      || this.#presented.mediaGeneration !== this.#committed.mediaGeneration
  }

  surfaceSize(): ManagedBrowserSize | undefined {
    if (this.#containerSize === undefined || this.#presented === undefined) return undefined
    const scale = Math.min(
      this.#containerSize.width / this.#presented.viewport.width,
      this.#containerSize.height / this.#presented.viewport.height,
    )
    return {
      width: Math.max(1, Math.round(this.#presented.viewport.width * scale)),
      height: Math.max(1, Math.round(this.#presented.viewport.height * scale)),
    }
  }

  mapPoint(point: { x: number; y: number }, surface: SurfaceBounds): { revision: number; x: number; y: number } | undefined {
    if (this.inputHeld() || this.#presented === undefined || surface.width <= 0 || surface.height <= 0) return undefined
    return {
      revision: this.#presented.revision,
      x: (point.x - surface.x) * this.#presented.viewport.width / surface.width,
      y: (point.y - surface.y) * this.#presented.viewport.height / surface.height,
    }
  }

  snapshot(): ManagedBrowserLayoutSnapshot {
    return {
      mode: this.#mode,
      ...this.#containerSize === undefined ? {} : { containerSize: copySize(this.#containerSize) },
      ...this.#committed === undefined ? {} : { committed: copyCommit(this.#committed) },
      ...this.#presented === undefined ? {} : { presented: copyCommit(this.#presented) },
      ...this.#encodedSize === undefined ? {} : { encodedSize: copySize(this.#encodedSize) },
      inputHeld: this.inputHeld(),
    }
  }

  #proposal(mode: ManagedBrowserLayoutMode, viewport: ManagedBrowserSize): ManagedBrowserLayoutProposal {
    this.#proposalSequence += 1
    return { proposalSequence: this.#proposalSequence, mode, viewport: copySize(viewport) }
  }

  #fitViewport(container: ManagedBrowserSize): ManagedBrowserSize {
    return {
      width: clamp(Math.round(container.width), this.#viewportLimits.min.width, this.#viewportLimits.max.width),
      height: clamp(Math.round(container.height), this.#viewportLimits.min.height, this.#viewportLimits.max.height),
    }
  }
}

function validCommit(commit: ManagedBrowserLayoutCommit): boolean {
  return Number.isSafeInteger(commit.revision) && commit.revision > 0
    && Number.isSafeInteger(commit.mediaGeneration) && commit.mediaGeneration > 0
    && validMode(commit.mode)
    && validSize(commit.viewport)
}

function validMode(mode: ManagedBrowserLayoutMode): boolean {
  return mode === 'fit' || mode === 'phone' || mode === 'tablet' || mode === 'laptop'
}

function validSize(size: ManagedBrowserSize): boolean {
  return Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0
}

function sameSize(left: ManagedBrowserSize, right: ManagedBrowserSize): boolean {
  return left.width === right.width && left.height === right.height
}

function nearSize(left: ManagedBrowserSize, right: ManagedBrowserSize, threshold: number): boolean {
  return Math.abs(left.width - right.width) <= threshold && Math.abs(left.height - right.height) <= threshold
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteNonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Managed Browser ' + name + ' must be finite and nonnegative')
  return value
}

function copySize(size: ManagedBrowserSize): ManagedBrowserSize {
  return { width: size.width, height: size.height }
}

function copyCommit(commit: ManagedBrowserLayoutCommit): ManagedBrowserLayoutCommit {
  return { ...commit, viewport: copySize(commit.viewport) }
}
