import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type WheelEvent } from 'react'
import { BrowserRtcCandidateBuffer, BrowserVisibilityGrace, browserAnnotationHighlightRects, browserAnnotationNodeAt, browserBinaryFrameIdentity, browserJsonFrameIdentity, browserMediaDeclineForFailure, browserMediaRetryRequest, browserMediaRouteFromHost, browserMediaRouteFromReceiver, browserPointerShouldFocusIme, browserSelectedRectForOutline, browserStreamFrameBuffer, browserStreamHello, browserStreamReady, browserStreamShouldRun, browserStreamSignalsReady, browserStreamTextMessage, browserSurfaceVisibilityMessage, browserTouchGestureMove, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserJpegJson, decodeBrowserLayoutCommit, decodeBrowserMediaRoute, decodeBrowserOutline, decodeBrowserTrackedRect, paintBrowserFrameForConnection, updateBrowserSelectedRect, type BrowserMediaFailureReason, type BrowserMediaPresentationRoute, type BrowserMediaRetryState, type BrowserOutlineNode, type BrowserTouchGesture } from './managed-browser-stream.ts'
import { ManagedBrowserLayoutClient } from './managed-browser-layout.ts'
import { publishBrowserPresentation, type BrowserPresentationConnection, type BrowserPresentationState } from './managed-browser-observability.ts'
import { BrowserVideoPresentationSwitch, browserWebRtcVideoAvailable, createBrowserDomPeer, handleBrowserVideoPresentation } from './managed-browser-webrtc-dom.ts'
import { ManagedBrowserWebRtcReceiver } from '../managed-browser-webrtc-client.ts'
import { decodeBrowserHostMessage, type BrowserInput, type BrowserLayout, type BrowserMediaIdentity, type BrowserReadyMessage, type BrowserRtcDescription, type BrowserStreamFrameV2 } from '../managed-browser-protocol.ts'
import type { BrowserDevice } from '../browser.ts'
import type { AnnotationRect } from '../session.ts'

type StreamTicket = { path: string; expiresAt: number }

type ManagedProjection = {
  url: string
  title: string
  documentId: string
  status: 'idle' | 'loading' | 'ready' | 'error' | 'crashed'
  error?: string
}

type ManagedBrowserCanvasProps = {
  tabId: string
  active: boolean
  device: BrowserDevice
  annotate: boolean
  selectedRect: AnnotationRect | null
  selectedSelector: string | null
  requestTicket: (tabId: string) => Promise<StreamTicket | undefined>
  onPick: (rect: AnnotationRect, anchor: Point, layout: Pick<BrowserLayout, 'revision' | 'mediaGeneration'>) => void | Promise<void>
  onState: (projection: ManagedProjection) => void
  children?: ReactNode
}

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type TouchGesture = BrowserTouchGesture & { pointerId: number }
type RevisionedInput = BrowserInput & { revision: number }

export function ManagedBrowserCanvas({ tabId, active, device, annotate, selectedRect, selectedSelector, requestTicket, onPick, onState, children }: ManagedBrowserCanvasProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const firstVideoRef = useRef<HTMLVideoElement>(null)
  const secondVideoRef = useRef<HTMLVideoElement>(null)
  const ticketRef = useRef(requestTicket)
  const stateRef = useRef(onState)
  const deviceRef = useRef(device)
  const viewportRef = useRef<Size>({ width: 720, height: 860 })
  const layoutRef = useRef<ManagedBrowserLayoutClient | null>(null)
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const receiverRef = useRef<ManagedBrowserWebRtcReceiver | null>(null)
  const activeReceiverRef = useRef<ManagedBrowserWebRtcReceiver | null>(null)
  const videoPresentationRef = useRef<BrowserVideoPresentationSwitch | null>(null)
  const readyRef = useRef<BrowserReadyMessage | null>(null)
  const visibilityGraceRef = useRef<BrowserVisibilityGrace | null>(null)
  const fallbackRetryRef = useRef<BrowserMediaRetryState>()
  const mediaRouteRef = useRef<BrowserMediaPresentationRoute>('reconnecting')
  const presentationConnectionRef = useRef<BrowserPresentationConnection>('connecting')
  const canvasIdentityRef = useRef<BrowserMediaIdentity | null>(null)
  const surfaceVisibleRef = useRef(true)
  const surfaceActiveRef = useRef(active)
  const visibilityUpdateRef = useRef<() => void>(() => {})
  ticketRef.current = requestTicket
  stateRef.current = onState
  deviceRef.current = device
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const annotateRef = useRef(annotate)
  const selectedSelectorRef = useRef(selectedSelector)
  const documentRef = useRef<string>()
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout>>()
  annotateRef.current = annotate
  selectedSelectorRef.current = selectedSelector
  const dragRef = useRef<{ point: Point; pointerId: number } | null>(null)
  const touchRef = useRef<TouchGesture | null>(null)
  const inputQueueRef = useRef<ReturnType<typeof createBrowserInputCoalescer> | null>(null)
  if (inputQueueRef.current === null) {
    inputQueueRef.current = createBrowserInputCoalescer((input) => {
      const { revision, ...payload } = input as RevisionedInput
      send(socketRef.current, { type: 'input', revision, input: payload })
    })
  }
  const [selection, setSelection] = useState<AnnotationRect | null>(null)
  const [outlineNodes, setOutlineNodes] = useState<BrowserOutlineNode[]>([])
  const [hovered, setHovered] = useState<AnnotationRect | null>(null)
  const [selectedLiveRect, setSelectedLiveRect] = useState<AnnotationRect | null>(selectedRect)
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [surfaceSize, setSurfaceSize] = useState<Size>({ width: 0, height: 0 })
  const [mediaRoute, setMediaRoute] = useState<BrowserMediaPresentationRoute>('reconnecting')
  const [visible, setVisible] = useState(() => active && (typeof document === 'undefined' || document.visibilityState === 'visible'))
  surfaceActiveRef.current = active

  const requestOutline = (delay = 0): void => {
    if (outlineTimerRef.current !== undefined) clearTimeout(outlineTimerRef.current)
    outlineTimerRef.current = undefined
    if (!annotateRef.current) return
    outlineTimerRef.current = setTimeout(() => {
      outlineTimerRef.current = undefined
      send(socketRef.current, { type: 'outline' })
    }, delay)
  }

  const requestMediaRetry = (trigger: 'explicit' | 'network-change' | 'tab-reactivate'): void => {
    const receiver = receiverRef.current
    if (receiver !== null) {
      receiver.requestRetry(trigger)
      return
    }
    const ready = readyRef.current
    const layout = layoutRef.current?.snapshot().committed
    if (ready === null || layout === undefined) return
    const request = browserMediaRetryRequest(
      fallbackRetryRef.current,
      { ownerId: ready.ownerId, revision: layout.revision, mediaGeneration: layout.mediaGeneration },
      trigger,
      ready.media.retryCooldownMs,
      Date.now(),
    )
    fallbackRetryRef.current = request.state
    if (request.message !== undefined) send(socketRef.current, request.message)
  }

  const publishPresentation = (state: BrowserPresentationState): boolean => {
    if (publishBrowserPresentation(surfaceRef.current ?? undefined, state) === undefined) return false
    presentationConnectionRef.current = state.connection
    mediaRouteRef.current = state.mediaRoute
    setMediaRoute(state.mediaRoute)
    return true
  }

  const publishMediaRoute = (route: BrowserMediaPresentationRoute): boolean => {
    const connected = presentationConnectionRef.current === 'connected'
    const videoSource = videoPresentationRef.current?.snapshot()
    return publishPresentation({
      connection: presentationConnectionRef.current,
      ownerId: connected ? readyRef.current?.ownerId ?? null : null,
      layout: connected ? layoutRef.current?.snapshot() ?? null : null,
      mediaRoute: route,
      source: !connected
        ? { presenter: 'none' }
        : videoSource?.presenter === 'video'
          ? videoSource
          : { presenter: 'canvas', identity: canvasIdentityRef.current },
    })
  }

  const publishSurfaceVisibility = (visible: boolean, socket: WebSocket | null = socketRef.current): void => {
    surfaceVisibleRef.current = visible
    const message = browserSurfaceVisibilityMessage(readyRef.current, layoutRef.current?.snapshot().committed, visible)
    if (message !== undefined) send(socket, message)
  }

  const updateSurface = (): void => {
    const surface = layoutRef.current?.surfaceSize()
    if (surface === undefined) return
    if (surfaceRef.current !== null) {
      surfaceRef.current.style.width = surface.width + 'px'
      surfaceRef.current.style.height = surface.height + 'px'
    }
    setSurfaceSize((current) => current.width === surface.width && current.height === surface.height ? current : surface)
  }

  const sendLayoutProposal = (proposal: ReturnType<ManagedBrowserLayoutClient['pollProposal']>, socket: WebSocket | null = socketRef.current): void => {
    if (proposal !== undefined) send(socket, { type: 'layout-propose', ...proposal })
  }

  const armLayoutTimer = (): void => {
    if (layoutTimerRef.current !== undefined) clearTimeout(layoutTimerRef.current)
    layoutTimerRef.current = undefined
    const dueAt = layoutRef.current?.proposalDueAt()
    if (dueAt === undefined) return
    layoutTimerRef.current = setTimeout(() => {
      layoutTimerRef.current = undefined
      sendLayoutProposal(layoutRef.current?.pollProposal(performance.now()))
      armLayoutTimer()
    }, Math.max(0, dueAt - performance.now()))
  }

  const observeContainer = (): void => {
    const root = rootRef.current
    if (root === null) return
    const bounds = root.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    layoutRef.current?.observeContainer({ width: bounds.width, height: bounds.height }, performance.now())
    updateSurface()
    publishMediaRoute(mediaRouteRef.current)
    armLayoutTimer()
  }

  useEffect(() => {
    const root = rootRef.current
    let intersecting = true
    const initialVisible = browserStreamShouldRun(typeof document === 'undefined' || document.visibilityState === 'visible', intersecting, surfaceActiveRef.current)
    const grace = new BrowserVisibilityGrace(initialVisible, setVisible)
    setVisible(initialVisible)
    visibilityGraceRef.current = grace
    const update = (): void => {
      const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible'
      const surfaceVisible = browserStreamShouldRun(pageVisible, intersecting, surfaceActiveRef.current)
      publishSurfaceVisibility(surfaceVisible)
      grace.setVisible(surfaceVisible)
    }
    visibilityUpdateRef.current = update
    const onVisibility = (): void => { update() }
    document.addEventListener('visibilitychange', onVisibility)
    let observer: IntersectionObserver | undefined
    if (root !== null && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        intersecting = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0)
        update()
      })
      observer.observe(root)
    }
    update()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      grace.dispose()
      if (visibilityUpdateRef.current === update) visibilityUpdateRef.current = () => {}
      if (visibilityGraceRef.current === grace) visibilityGraceRef.current = null
    }
  }, [tabId])

  useEffect(() => {
    if (!active) {
      inputQueueRef.current?.cancel()
      if (layoutTimerRef.current !== undefined) clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = undefined
      if (outlineTimerRef.current !== undefined) clearTimeout(outlineTimerRef.current)
      outlineTimerRef.current = undefined
    }
    visibilityUpdateRef.current()
    if (active) observeContainer()
  }, [active, tabId])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { observeContainer() })
    observer?.observe(root)
    observeContainer()
    return () => { observer?.disconnect() }
  }, [tabId])

  useEffect(() => {
    const layout = layoutRef.current
    if (layout === null) return
    sendLayoutProposal(layout.selectMode(device, performance.now()))
    observeContainer()
  }, [device, tabId])

  useEffect(() => {
    setOutlineNodes([])
    setHovered(null)
    if (annotate) requestOutline()
    return () => {
      if (outlineTimerRef.current !== undefined) clearTimeout(outlineTimerRef.current)
      outlineTimerRef.current = undefined
    }
  }, [annotate, tabId])

  useEffect(() => {
    setSelectedLiveRect(selectedRect)
    if (selectedSelector !== null) requestOutline()
  }, [selectedRect?.x, selectedRect?.y, selectedRect?.w, selectedRect?.h, selectedSelector])

  useEffect(() => {
    let stopped = false
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let decoding = false
    let connectionGeneration = 0
    let cleanupMediaListeners = (): void => {}
    let latest: { frame: BrowserStreamFrameV2; socket: WebSocket; generation: number } | undefined
    const earlyCandidates = new BrowserRtcCandidateBuffer()

    if (!visible) {
      setStatus('connecting')
      return () => { inputQueueRef.current?.cancel() }
    }

    const videoPresentation = (): BrowserVideoPresentationSwitch | undefined => {
      if (videoPresentationRef.current !== null) return videoPresentationRef.current
      const first = firstVideoRef.current
      const second = secondVideoRef.current
      const canvas = canvasRef.current
      if (first === null || second === null || canvas === null) return undefined
      const presentation = new BrowserVideoPresentationSwitch([first, second], canvas)
      videoPresentationRef.current = presentation
      return presentation
    }

    const disposeMedia = (): void => {
      const receiver = receiverRef.current
      const activeReceiver = activeReceiverRef.current
      receiver?.dispose()
      if (activeReceiver !== receiver) activeReceiver?.dispose()
      receiverRef.current = null
      activeReceiverRef.current = null
      videoPresentationRef.current?.clear()
    }

    const prepareMediaGeneration = (): void => {
      const receiver = receiverRef.current
      if (receiver !== activeReceiverRef.current) receiver?.dispose()
      receiverRef.current = null
      videoPresentationRef.current?.discardPending()
    }

    const drawLatest = async (): Promise<void> => {
      if (decoding) return
      decoding = true
      try {
        while (!stopped && latest !== undefined) {
          const frame = latest
          latest = undefined
          const canvas = canvasRef.current
          if (canvas === null) return
          const identity = { sequence: frame.frame.sequence, revision: frame.frame.revision, mediaGeneration: frame.frame.mediaGeneration }
          const frameCurrent = (): boolean => {
            const committed = layoutRef.current?.snapshot().committed
            return committed !== undefined
              && committed.revision === frame.frame.revision
              && committed.mediaGeneration === frame.frame.mediaGeneration
              && committed.viewport.width === frame.frame.viewport.width
              && committed.viewport.height === frame.frame.viewport.height
          }
          await paintBrowserFrameForConnection(
            identity,
            () => createImageBitmap(new Blob([frame.frame.jpeg], { type: 'image/jpeg' })),
            () => !stopped && socketRef.current === frame.socket && connectionGeneration === frame.generation,
            frameCurrent,
            () => {
              const ownerId = readyRef.current?.ownerId
              if (ownerId === undefined) return false
              const accepted = layoutRef.current?.acceptFrame(frame.frame).accepted === true
              if (accepted) {
                canvasIdentityRef.current = { ownerId, revision: frame.frame.revision, mediaGeneration: frame.frame.mediaGeneration }
                const presented = layoutRef.current?.snapshot().presented
                if (presented !== undefined) viewportRef.current = presented.viewport
                videoPresentation()?.showCanvas()
                updateSurface()
                publishMediaRoute(mediaRouteRef.current)
                const activeReceiver = activeReceiverRef.current
                activeReceiverRef.current = null
                if (activeReceiver !== receiverRef.current) activeReceiver?.dispose()
                setStatus('ready')
              }
              return accepted
            },
            (bitmap) => {
              if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                canvas.width = bitmap.width
                canvas.height = bitmap.height
              }
              const context = canvas.getContext('bitmaprenderer')
              if (context !== null) context.transferFromImageBitmap(bitmap)
              else canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
            },
            (bitmap) => { bitmap.close() },
            (ack) => { send(frame.socket, { type: 'frame-ack', ...ack }) },
          )
        }
      } catch {
        // DSH Mobile's tunnel used to UTF-8-mangle binary JPEGs; skip a bad frame.
      } finally {
        decoding = false
      }
    }

    const connect = async (): Promise<void> => {
      setStatus('connecting')
      presentationConnectionRef.current = 'connecting'
      publishMediaRoute('reconnecting')
      const ticket = await ticketRef.current(tabId)
      if (stopped) return
      if (ticket === undefined) {
        reconnect = setTimeout(() => { void connect() }, Math.min(2000, 250 * 2 ** attempt++))
        return
      }
      const socket = new WebSocket(browserWebSocketUrl(ticket.path))
      earlyCandidates.clear()
      const generation = ++connectionGeneration
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      const isCurrent = (): boolean => !stopped && socketRef.current === socket && connectionGeneration === generation
      const currentMediaIdentity = (): BrowserMediaIdentity | undefined => {
        const ready = readyRef.current
        const committed = layoutRef.current?.snapshot().committed
        return ready === null || committed === undefined
          ? undefined
          : { ownerId: ready.ownerId, revision: committed.revision, mediaGeneration: committed.mediaGeneration }
      }
      const declineMedia = (identity: BrowserMediaIdentity, reason: BrowserMediaFailureReason | undefined): void => {
        if (!isCurrent()) return
        const decline = browserMediaDeclineForFailure(identity, currentMediaIdentity(), reason)
        if (decline !== undefined) send(socket, decline)
      }
      socket.onopen = () => {
        if (!isCurrent()) return
        attempt = 0
        send(socket, browserStreamHello(browserWebRtcVideoAvailable()))
        if (annotateRef.current) requestOutline()
      }
      const acceptJpeg = (frame: BrowserStreamFrameV2): void => {
        if (!isCurrent()) return
        const committed = layoutRef.current?.snapshot().committed
        if (committed === undefined || committed.revision !== frame.revision || committed.mediaGeneration !== frame.mediaGeneration
          || committed.viewport.width !== frame.viewport.width || committed.viewport.height !== frame.viewport.height) return
        latest = { frame, socket, generation }
        void drawLatest()
      }
      const acceptBinary = (buffer: ArrayBuffer): void => {
        try {
          const frame = decodeBrowserFrame(buffer)
          acceptJpeg(frame)
        } catch {
          const identity = browserBinaryFrameIdentity(buffer)
          const committed = layoutRef.current?.snapshot().committed
          if (identity !== undefined && committed?.revision === identity.revision && committed.mediaGeneration === identity.mediaGeneration && isCurrent()) {
            send(socket, { type: 'frame-ack', ...identity })
          }
        }
      }
      socket.onmessage = (event) => {
        if (!isCurrent()) return
        const buffer = browserStreamFrameBuffer(event.data)
        if (buffer !== undefined) {
          acceptBinary(buffer)
          return
        }
        if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
          void event.data.arrayBuffer().then((value) => {
            if (!stopped) acceptBinary(value)
          }).catch(() => undefined)
          return
        }
        const text = browserStreamTextMessage(event.data)
        if (text === undefined) return
        const jpegFrame = decodeBrowserJpegJson(text)
        if (jpegFrame !== undefined) {
          acceptJpeg(jpegFrame)
          return
        }
        const failedFrame = browserJsonFrameIdentity(text)
        const committed = layoutRef.current?.snapshot().committed
        if (failedFrame !== undefined && committed?.revision === failedFrame.revision && committed.mediaGeneration === failedFrame.mediaGeneration) {
          send(socket, { type: 'frame-ack', ...failedFrame })
          return
        }
        if (browserStreamSignalsReady(text)) setStatus('ready')
        const layoutCommit = decodeBrowserLayoutCommit(text)
        if (layoutCommit !== undefined) {
          if (layoutRef.current?.acceptCommit(layoutCommit.layout)) {
            inputQueueRef.current?.cancel()
            prepareMediaGeneration()
            publishMediaRoute('reconnecting')
            const ready = readyRef.current
            if (ready === null) earlyCandidates.clear()
            else earlyCandidates.setIdentity({
              ownerId: ready.ownerId,
              revision: layoutCommit.layout.revision,
              mediaGeneration: layoutCommit.layout.mediaGeneration,
            })
            publishSurfaceVisibility(surfaceVisibleRef.current, socket)
          }
          return
        }
        const mediaRouteMessage = decodeBrowserMediaRoute(text)
        if (mediaRouteMessage !== undefined) {
          const route = browserMediaRouteFromHost(mediaRouteMessage, mediaRouteRef.current)
          if (mediaRouteMessage.route === 'unavailable') {
            prepareMediaGeneration()
            publishMediaRoute(route)
          } else if (mediaRouteMessage.route === 'jpeg-fallback') {
            receiverRef.current?.useFallback('host-fallback')
            publishMediaRoute(route)
          } else {
            publishMediaRoute(route)
          }
          return
        }

        const hostMessage = decodeBrowserHostMessage(text)
        if (hostMessage?.type === 'rtc-offer') {
          const ready = readyRef.current
          const committed = layoutRef.current?.snapshot().committed
          const presentation = videoPresentation()
          if (ready === null || presentation === undefined || hostMessage.ownerId !== ready.ownerId
            || committed?.revision !== hostMessage.revision || committed.mediaGeneration !== hostMessage.mediaGeneration) return
          const previousReceiver = receiverRef.current
          if (previousReceiver !== activeReceiverRef.current) previousReceiver?.dispose()
          presentation.discardPending()
          earlyCandidates.setIdentity(hostMessage)
          const identity: BrowserMediaIdentity = hostMessage
          const stage = presentation.stage(identity, ready.media.negotiationTimeoutMs)
          const surface = stage.surface
          let videoSize: Size | undefined
          const receiver = new ManagedBrowserWebRtcReceiver({
            identity,
            peerFactory: createBrowserDomPeer,
            negotiationTimeoutMs: ready.media.negotiationTimeoutMs,
            retryCooldownMs: ready.media.retryCooldownMs,
            onEvent: (event) => {
              if (receiverRef.current !== receiver || !isCurrent()) return
              if (event.event.type === 'candidate') {
                send(socket, { type: 'rtc-candidate', ownerId: event.ownerId, revision: event.revision, mediaGeneration: event.mediaGeneration, candidate: event.event.candidate })
              } else if (event.event.type === 'video-track') {
                const track = event.event.track
                void handleBrowserVideoPresentation(
                  surface.present(track),
                  () => {
                    const current = currentMediaIdentity()
                    return receiverRef.current === receiver && isCurrent() && current !== undefined
                      && current.ownerId === identity.ownerId && current.revision === identity.revision
                      && current.mediaGeneration === identity.mediaGeneration
                  },
                  (size) => {
                    videoSize = size
                    receiver.markFrameReady(identity, track)
                  },
                  () => { receiver.useFallback('presentation-failed') },
                )
              } else if (event.event.type === 'generation-ready') {
                const current = layoutRef.current?.snapshot().committed
                if (current === undefined || videoSize === undefined || !presentation.canCommit(stage)
                  || event.ownerId !== ready.ownerId || event.revision !== current.revision
                  || event.mediaGeneration !== current.mediaGeneration) return
                const accepted = layoutRef.current?.acceptFrame({
                  revision: event.revision,
                  mediaGeneration: event.mediaGeneration,
                  viewport: current.viewport,
                  encodedSize: videoSize,
                }).accepted
                if (accepted && presentation.commit(stage)) {
                  const previousActive = activeReceiverRef.current
                  activeReceiverRef.current = receiver
                  if (previousActive !== receiver) previousActive?.dispose()
                  viewportRef.current = current.viewport
                  updateSurface()
                  publishMediaRoute('direct-video')
                  setStatus('ready')
                }
              } else if (event.event.type === 'retry-request') {
                send(socket, { type: 'media-retry', ownerId: event.ownerId, revision: event.revision, mediaGeneration: event.mediaGeneration, trigger: event.event.trigger })
              } else if (event.event.type === 'route') {
                publishMediaRoute(browserMediaRouteFromReceiver(event.event.route))
                if (event.event.route === 'jpeg-fallback') {
                  presentation.discard(stage)
                  declineMedia(event, event.event.reason)
                }
              }
            },
          })
          receiverRef.current = receiver
          let negotiation: Promise<BrowserRtcDescription | undefined>
          try {
            negotiation = receiver.acceptOffer(identity, hostMessage.description)
          } catch {
            declineMedia(hostMessage, 'negotiation-error')
            presentation.discard(stage)
            if (receiverRef.current === receiver) receiverRef.current = null
            receiver.dispose()
            publishMediaRoute('low-bandwidth-fallback')
            return
          }
          const pendingCandidates = earlyCandidates.drain(hostMessage)
          void (async () => {
            for (const candidate of pendingCandidates) {
              if (receiverRef.current !== receiver || !isCurrent()) return
              await receiver.addCandidate(identity, candidate)
            }
          })()
          void negotiation.then((answer) => {
            if (answer !== undefined && receiverRef.current === receiver && isCurrent()) {
              send(socket, { type: 'rtc-answer', ...identity, description: answer })
            }
          })
          return
        }
        if (hostMessage?.type === 'rtc-candidate') {
          const ready = readyRef.current
          const committed = layoutRef.current?.snapshot().committed
          if (ready === null || hostMessage.ownerId !== ready.ownerId || committed?.revision !== hostMessage.revision
            || committed.mediaGeneration !== hostMessage.mediaGeneration) return
          const identity = { ownerId: ready.ownerId, revision: committed.revision, mediaGeneration: committed.mediaGeneration }
          earlyCandidates.setIdentity(identity)
          const receiver = receiverRef.current
          if (receiver === null) earlyCandidates.add(hostMessage, hostMessage.candidate)
          else void receiver.addCandidate(hostMessage, hostMessage.candidate)
          return
        }
        const tracked = decodeBrowserTrackedRect(text)
        if (tracked !== undefined) {
          if ((documentRef.current === undefined || documentRef.current === tracked.documentId) && selectedSelectorRef.current === tracked.selector) {
            setSelectedLiveRect((current) => updateBrowserSelectedRect(current, { type: 'tracked', rect: tracked.rect }))
          }
          return
        }
        const outline = decodeBrowserOutline(text)
        if (outline !== undefined) {
          if (documentRef.current === undefined || documentRef.current === outline.documentId) {
            documentRef.current = outline.documentId
            setOutlineNodes(outline.nodes)
            const selector = selectedSelectorRef.current
            if (selector !== null) setSelectedLiveRect(browserSelectedRectForOutline(selector, outline.nodes))
          }
          return
        }
        try {
          const message = JSON.parse(text) as { type?: unknown; projection?: unknown }
          if (message.type === 'ready') {
            const ready = browserStreamReady(text)
            if (ready === undefined) socket.close(1002, 'Unsupported Browser stream protocol')
            else {
              readyRef.current = ready
              visibilityGraceRef.current?.setGraceMs(ready.media.hideGraceMs)
              layoutRef.current = new ManagedBrowserLayoutClient({
                mode: deviceRef.current,
                settleMs: ready.layoutPolicy.settleMs,
                hysteresisPx: ready.layoutPolicy.hysteresisPx,
                viewportLimits: { min: ready.layoutPolicy.minViewport, max: ready.layoutPolicy.maxViewport },
              })
              presentationConnectionRef.current = 'connected'
              publishMediaRoute(mediaRouteRef.current)
              earlyCandidates.clear()
              observeContainer()
              sendLayoutProposal(layoutRef.current.selectMode(deviceRef.current, performance.now()), socket)
              armLayoutTimer()
            }
          }
          if (message.type === 'state' && managedProjection(message.projection)) {
            if (documentRef.current !== undefined && documentRef.current !== message.projection.documentId) {
              setOutlineNodes([])
              setHovered(null)
              setSelectedLiveRect(null)
            }
            documentRef.current = message.projection.documentId
            stateRef.current(message.projection)
            if (annotateRef.current && message.projection.status === 'ready') requestOutline()
          }
        } catch {
          // APP WebViews sometimes deliver non-protocol text; keep the last good frame.
        }
      }
      socket.onerror = () => {
        if (!isCurrent()) return
        setStatus('error')
        publishMediaRoute('unavailable')
      }
      const retryNetwork = (): void => { if (surfaceActiveRef.current) requestMediaRetry('network-change') }
      const retryVisible = (): void => {
        if (surfaceActiveRef.current && document.visibilityState === 'visible') requestMediaRetry('tab-reactivate')
      }
      window.addEventListener('online', retryNetwork)
      document.addEventListener('visibilitychange', retryVisible)
      cleanupMediaListeners = () => {
        window.removeEventListener('online', retryNetwork)
        document.removeEventListener('visibilitychange', retryVisible)
      }
      socket.onclose = () => {
        const wasCurrent = socketRef.current === socket
        if (wasCurrent) {
          socketRef.current = null
          layoutRef.current = null
          inputQueueRef.current?.cancel()
          if (layoutTimerRef.current !== undefined) clearTimeout(layoutTimerRef.current)
          layoutTimerRef.current = undefined
          setStatus('connecting')
          presentationConnectionRef.current = 'disconnected'
          publishMediaRoute('reconnecting')
          disposeMedia()
          readyRef.current = null
          earlyCandidates.clear()
          cleanupMediaListeners()
        }
        if (wasCurrent && !stopped) reconnect = setTimeout(() => { void connect() }, Math.min(2000, 250 * 2 ** attempt++))
      }
    }

    void connect()
    return () => {
      stopped = true
      if (reconnect !== undefined) clearTimeout(reconnect)
      if (layoutTimerRef.current !== undefined) clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = undefined
      layoutRef.current = null
      readyRef.current = null
      earlyCandidates.clear()
      presentationConnectionRef.current = 'disconnected'
      publishMediaRoute('unavailable')
      disposeMedia()
      cleanupMediaListeners()
      socketRef.current?.close(1000, 'Browser surface hidden')
      socketRef.current = null
      inputQueueRef.current?.cancel()
    }
  }, [tabId, visible])

  const point = (event: { clientX: number; clientY: number }): (Point & { revision: number }) | undefined => {
    const surface = surfaceRef.current
    if (surface === null) return undefined
    const bounds = surface.getBoundingClientRect()
    return layoutRef.current?.mapPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
    )
  }

  const input = (value: BrowserInput, revision?: number): void => {
    const resolved = revision ?? (layoutRef.current?.inputHeld() === false ? layoutRef.current.snapshot().presented?.revision : undefined)
    if (resolved !== undefined) inputQueueRef.current?.push({ ...value, revision: resolved })
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = point(event)
    if (at === undefined) return
    const { revision, ...coordinates } = at
    if (annotate) {
      dragRef.current = { point: at, pointerId: event.pointerId }
      setHovered(null)
      setSelection({ x: at.x, y: at.y, w: 0, h: 0 })
      return
    }
    if (event.pointerType === 'touch') {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      inputRef.current?.blur()
      touchRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      }
      return
    }
    if (browserPointerShouldFocusIme(event.pointerType)) inputRef.current?.focus({ preventScroll: true })
    input({ type: 'down', ...coordinates, pressed: true }, revision)
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = point(event)
    if (at === undefined) return
    const { revision, ...coordinates } = at
    const drag = dragRef.current
    if (annotate) {
      if (drag?.pointerId === event.pointerId) setSelection(rectFrom(drag.point, at))
      else setHovered(browserAnnotationNodeAt(outlineNodes, at)?.rect ?? null)
      return
    }
    const touch = touchRef.current
    if (touch?.pointerId === event.pointerId) {
      event.preventDefault()
      const update = browserTouchGestureMove(touch, event.clientX, event.clientY)
      touchRef.current = { ...update.gesture, pointerId: event.pointerId }
      if (update.moved && (update.deltaX !== 0 || update.deltaY !== 0)) {
        input({ type: 'wheel', ...coordinates, deltaX: update.deltaX, deltaY: update.deltaY }, revision)
      }
      return
    }
    input({ type: 'move', ...coordinates, pressed: event.buttons === 1 }, revision)
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = point(event)
    if (at === undefined) return
    const { revision, ...coordinates } = at
    const drag = dragRef.current
    if (annotate && drag?.pointerId === event.pointerId) {
      const rect = rectFrom(drag.point, at)
      dragRef.current = null
      setSelection(null)
      setHovered(browserAnnotationNodeAt(outlineNodes, at)?.rect ?? null)
      const canvasBounds = event.currentTarget.getBoundingClientRect()
      const rootBounds = rootRef.current?.getBoundingClientRect() ?? canvasBounds
      const presented = layoutRef.current?.snapshot().presented
      if (presented === undefined || presented.revision !== revision) return
      void onPick(
        rect.w < 4 && rect.h < 4 ? { x: at.x - 8, y: at.y - 8, w: 16, h: 16 } : rect,
        { x: event.clientX - rootBounds.left, y: event.clientY - rootBounds.top },
        { revision: presented.revision, mediaGeneration: presented.mediaGeneration },
      )
      return
    }
    const touch = touchRef.current
    if (touch?.pointerId === event.pointerId) {
      event.preventDefault()
      touchRef.current = null
      if (!touch.moved) input({ type: 'tap', ...coordinates }, revision)
      return
    }
    input({ type: 'up', ...coordinates, pressed: false }, revision)
  }

  const onWheel = (event: WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    const at = point(event)
    if (at === undefined) return
    const { revision, ...coordinates } = at
    if (annotate) {
      setOutlineNodes([])
      setHovered(null)
      setSelectedLiveRect((current) => updateBrowserSelectedRect(current, { type: 'wheel' }))
      requestOutline(180)
    }
    const selector = selectedSelectorRef.current
    input({ type: 'wheel', ...coordinates, deltaX: event.deltaX, deltaY: event.deltaY, ...selector === null ? {} : { selector } }, revision)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, type: 'keyDown' | 'keyUp'): void => {
    input({ type, key: event.key, code: event.code, modifiers: modifiers(event) })
    if (event.key === 'Tab' || event.key === 'Backspace' || event.key === 'Enter' || event.metaKey || event.ctrlKey || event.altKey) {
      event.preventDefault()
    }
  }

  const setImeVisible = (visible: boolean): void => {
    layoutRef.current?.setImeVisible(visible, performance.now())
    armLayoutTimer()
  }

  const highlights = browserAnnotationHighlightRects(selectedLiveRect, hovered)
  const surfaceStyle = surfaceSize.width <= 0 || surfaceSize.height <= 0
    ? { width: '100%', height: '100%' }
    : { width: surfaceSize.width + 'px', height: surfaceSize.height + 'px' }

  return (
    <div className="dcs-managed-browser" ref={rootRef}>
      <div className="dcs-managed-browser-surface" ref={surfaceRef} style={surfaceStyle}>
        <video
          ref={firstVideoRef}
          className="dcs-managed-browser-video"
          muted
          autoPlay
          playsInline
          hidden
          onResize={() => { publishMediaRoute(mediaRouteRef.current) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
        <video
          ref={secondVideoRef}
          className="dcs-managed-browser-video"
          muted
          autoPlay
          playsInline
          hidden
          onResize={() => { publishMediaRoute(mediaRouteRef.current) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
        <canvas
          ref={canvasRef}
          className="dcs-managed-browser-canvas"
          tabIndex={-1}
          style={{ opacity: 1, position: 'relative', zIndex: 1 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; touchRef.current = null; setSelection(null); setHovered(null) }}
          onPointerLeave={() => { if (dragRef.current === null) setHovered(null) }}
          onWheel={onWheel}
        />
        {annotate && selection === null && highlights.selected !== null && <div className="dcs-managed-selected" style={selectionStyle(highlights.selected, viewportRef.current)} />}
        {annotate && selection === null && highlights.hovered !== null && <div className="dcs-managed-hover" style={selectionStyle(highlights.hovered, viewportRef.current)} />}
        {annotate && selection !== null && <div className="dcs-managed-selection" style={selectionStyle(selection, viewportRef.current)} />}
        {children}
      </div>
      {mediaRoute === 'direct-video' && <div className="dcs-managed-browser-route" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 5 }}>Direct video</div>}
      {mediaRoute === 'reconnecting' && <div className="dcs-managed-browser-route" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 5 }}>Reconnecting video…</div>}
      {mediaRoute === 'low-bandwidth-fallback' && <button className="dcs-managed-browser-route" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 5 }} type="button" onClick={() => { requestMediaRetry('explicit') }}>Low-bandwidth fallback · Retry video</button>}
      {mediaRoute === 'unavailable' && <div className="dcs-managed-browser-route" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 5 }}>Video unavailable</div>}
      <textarea
        ref={inputRef}
        className="dcs-managed-ime"
        aria-label="Browser keyboard input"
        onFocus={() => { setImeVisible(true) }}
        onBlur={() => { setImeVisible(false) }}
        onCompositionStart={() => { setImeVisible(true) }}
        onKeyDown={(event) => { onKey(event, 'keyDown') }}
        onKeyUp={(event) => { onKey(event, 'keyUp') }}
        onInput={(event) => {
          const text = event.currentTarget.value
          if (text.length > 0) input({ type: 'text', text })
          event.currentTarget.value = ''
        }}
      />
      {status !== 'ready' && <div className="dcs-managed-browser-status">{status === 'error' ? 'Browser stream unavailable' : 'Connecting…'}</div>}
    </div>
  )
}

function managedProjection(value: unknown): value is ManagedProjection {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.url === 'string'
    && typeof record.title === 'string'
    && typeof record.documentId === 'string'
    && (record.status === 'idle' || record.status === 'loading' || record.status === 'ready' || record.status === 'error' || record.status === 'crashed')
    && (record.error === undefined || typeof record.error === 'string')
}

function send(socket: WebSocket | null, value: object): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function rectFrom(start: Point, end: Point): AnnotationRect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) }
}

function modifiers(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

function selectionStyle(rect: AnnotationRect, viewport: Size): Record<string, string> {
  return {
    left: rect.x / Math.max(1, viewport.width) * 100 + '%',
    top: rect.y / Math.max(1, viewport.height) * 100 + '%',
    width: rect.w / Math.max(1, viewport.width) * 100 + '%',
    height: rect.h / Math.max(1, viewport.height) * 100 + '%',
  }
}
