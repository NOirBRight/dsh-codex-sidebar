import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type WheelEvent } from 'react'
import { browserAnnotationHighlightRects, browserAnnotationNodeAt, browserPointerShouldFocusIme, browserSelectedRectForOutline, browserStreamFitSurface, browserStreamFrameBuffer, browserStreamShouldRun, browserStreamSignalsReady, browserStreamTextMessage, browserTouchGestureMove, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserJpegJson, decodeBrowserOutline, decodeBrowserTrackedRect, updateBrowserSelectedRect, type BrowserOutlineNode, type BrowserTouchGesture } from './managed-browser-stream.ts'
import { browserDeviceViewport, type BrowserDevice } from '../browser.ts'
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
  device: BrowserDevice
  annotate: boolean
  selectedRect: AnnotationRect | null
  selectedSelector: string | null
  requestTicket: (tabId: string) => Promise<StreamTicket | undefined>
  onPick: (rect: AnnotationRect, anchor: Point) => void | Promise<void>
  onState: (projection: ManagedProjection) => void
  children?: ReactNode
}

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type TouchGesture = BrowserTouchGesture & { pointerId: number }

export function ManagedBrowserCanvas({ tabId, device, annotate, selectedRect, selectedSelector, requestTicket, onPick, onState, children }: ManagedBrowserCanvasProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ticketRef = useRef(requestTicket)
  const stateRef = useRef(onState)
  const deviceRef = useRef(device)
  const viewportRef = useRef<Size>({ width: 720, height: 860 })
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
      send(socketRef.current, { type: 'input', input })
    })
  }
  const [selection, setSelection] = useState<AnnotationRect | null>(null)
  const [outlineNodes, setOutlineNodes] = useState<BrowserOutlineNode[]>([])
  const [hovered, setHovered] = useState<AnnotationRect | null>(null)
  const [selectedLiveRect, setSelectedLiveRect] = useState<AnnotationRect | null>(selectedRect)
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [surfaceSize, setSurfaceSize] = useState<Size>({ width: 0, height: 0 })
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')

  const requestOutline = (delay = 0): void => {
    if (outlineTimerRef.current !== undefined) clearTimeout(outlineTimerRef.current)
    outlineTimerRef.current = undefined
    if (!annotateRef.current) return
    outlineTimerRef.current = setTimeout(() => {
      outlineTimerRef.current = undefined
      send(socketRef.current, { type: 'outline' })
    }, delay)
  }

  const sendLayout = (socket: WebSocket | null = socketRef.current): void => {
    const root = rootRef.current
    if (root === null) return
    const bounds = root.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const fixed = browserDeviceViewport(deviceRef.current)
    const viewport = fixed ?? {
      width: clamp(Math.round(bounds.width), 320, 1920),
      height: clamp(Math.round(bounds.height), 240, 1440),
    }
    viewportRef.current = viewport
    const surface = fixed === null
      ? { width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) }
      : fitSurface(bounds.width, bounds.height, fixed)
    setSurfaceSize((current) => current.width === surface.width && current.height === surface.height ? current : surface)
    send(socket, { type: 'resize', width: viewport.width, height: viewport.height })
  }

  useEffect(() => {
    const root = rootRef.current
    let intersecting = true
    const update = (): void => {
      const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible'
      setVisible(browserStreamShouldRun(pageVisible, intersecting))
    }
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
    }
  }, [tabId])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { sendLayout() })
    observer?.observe(root)
    sendLayout()
    return () => { observer?.disconnect() }
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
    let latest: Uint8Array | undefined

    if (!visible) {
      setStatus('connecting')
      return () => { inputQueueRef.current?.cancel() }
    }

    const drawLatest = async (): Promise<void> => {
      if (decoding) return
      decoding = true
      try {
        while (!stopped && latest !== undefined) {
          const jpeg = latest
          latest = undefined
          const canvas = canvasRef.current
          if (canvas === null) return
          const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width
            canvas.height = bitmap.height
          }
          const context = canvas.getContext('bitmaprenderer')
          if (context !== null) context.transferFromImageBitmap(bitmap)
          else canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
          bitmap.close()
          setStatus('ready')
        }
      } catch {
        // DSH Mobile's tunnel used to UTF-8-mangle binary JPEGs; skip a bad frame.
      } finally {
        decoding = false
      }
    }

    const connect = async (): Promise<void> => {
      setStatus('connecting')
      const ticket = await ticketRef.current(tabId)
      if (stopped) return
      if (ticket === undefined) {
        reconnect = setTimeout(() => { void connect() }, Math.min(2000, 250 * 2 ** attempt++))
        return
      }
      const socket = new WebSocket(browserWebSocketUrl(ticket.path))
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      socket.onopen = () => {
        attempt = 0
        sendLayout(socket)
        if (annotateRef.current) requestOutline()
      }
      const acceptJpeg = (jpeg: Uint8Array, css?: { width: number; height: number }): void => {
        if (css !== undefined && css.width > 0 && css.height > 0) {
          viewportRef.current = css
          const root = rootRef.current
          if (root !== null) {
            const bounds = root.getBoundingClientRect()
            if (bounds.width > 0 && bounds.height > 0) {
              const surface = browserStreamFitSurface(
                { width: bounds.width, height: bounds.height },
                css,
              )
              setSurfaceSize((current) => current.width === surface.width && current.height === surface.height ? current : surface)
            }
          }
        }
        latest = jpeg
        void drawLatest()
      }
      const acceptBinary = (buffer: ArrayBuffer): void => {
        try {
          const frame = decodeBrowserFrame(buffer)
          if (frame.version === 1) acceptJpeg(frame.jpeg, { width: frame.width, height: frame.height })
        } catch {
          // Ignore truncated binary leftovers from the mobile tunnel.
        }
      }
      socket.onmessage = (event) => {
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
          acceptJpeg(jpegFrame.jpeg, { width: jpegFrame.width, height: jpegFrame.height })
          return
        }
        if (browserStreamSignalsReady(text)) setStatus('ready')
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
          if (message.type === 'ready') setStatus('ready')
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
      socket.onerror = () => { setStatus('error') }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!stopped) reconnect = setTimeout(() => { void connect() }, Math.min(2000, 250 * 2 ** attempt++))
      }
    }

    void connect()
    return () => {
      stopped = true
      if (reconnect !== undefined) clearTimeout(reconnect)
      socketRef.current?.close(1000, 'Browser surface hidden')
      socketRef.current = null
      inputQueueRef.current?.cancel()
    }
  }, [tabId, visible])

  const point = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current
    if (canvas === null) return { x: 0, y: 0 }
    const bounds = canvas.getBoundingClientRect()
    const viewport = viewportRef.current
    return {
      x: (event.clientX - bounds.left) * viewport.width / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) * viewport.height / Math.max(1, bounds.height),
    }
  }

  const input = (value: { type: string; [key: string]: unknown }): void => { inputQueueRef.current?.push(value) }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = point(event)
    if (annotate) {
      dragRef.current = { point: at, pointerId: event.pointerId }
      setHovered(null)
      setSelection({ x: at.x, y: at.y, w: 0, h: 0 })
      return
    }
    if (event.pointerType === 'touch') {
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
    input({ type: 'down', ...at, pressed: true })
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = point(event)
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
        input({ type: 'wheel', ...at, deltaX: update.deltaX, deltaY: update.deltaY })
      }
      return
    }
    input({ type: 'move', ...at, pressed: event.buttons === 1 })
  }

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = point(event)
    const drag = dragRef.current
    if (annotate && drag?.pointerId === event.pointerId) {
      const rect = rectFrom(drag.point, at)
      dragRef.current = null
      setSelection(null)
      setHovered(browserAnnotationNodeAt(outlineNodes, at)?.rect ?? null)
      const canvasBounds = event.currentTarget.getBoundingClientRect()
      const rootBounds = rootRef.current?.getBoundingClientRect() ?? canvasBounds
      void onPick(
        rect.w < 4 && rect.h < 4 ? { x: at.x - 8, y: at.y - 8, w: 16, h: 16 } : rect,
        { x: event.clientX - rootBounds.left, y: event.clientY - rootBounds.top },
      )
      return
    }
    const touch = touchRef.current
    if (touch?.pointerId === event.pointerId) {
      event.preventDefault()
      touchRef.current = null
      if (!touch.moved) input({ type: 'tap', ...at })
      return
    }
    input({ type: 'up', ...at, pressed: false })
  }

  const onWheel = (event: WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault()
    const at = point(event)
    if (annotate) {
      setOutlineNodes([])
      setHovered(null)
      setSelectedLiveRect((current) => updateBrowserSelectedRect(current, { type: 'wheel' }))
      requestOutline(180)
    }
    const selector = selectedSelectorRef.current
    input({ type: 'wheel', ...at, deltaX: event.deltaX, deltaY: event.deltaY, ...selector === null ? {} : { selector } })
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, type: 'keyDown' | 'keyUp'): void => {
    input({ type, key: event.key, code: event.code, modifiers: modifiers(event) })
    if (event.key === 'Tab' || event.key === 'Backspace' || event.key === 'Enter' || event.metaKey || event.ctrlKey || event.altKey) {
      event.preventDefault()
    }
  }

  const highlights = browserAnnotationHighlightRects(selectedLiveRect, hovered)
  const surfaceStyle = surfaceSize.width <= 0 || surfaceSize.height <= 0
    ? { width: '100%', height: '100%' }
    : { width: surfaceSize.width + 'px', height: surfaceSize.height + 'px' }

  return (
    <div className="dcs-managed-browser" ref={rootRef}>
      <div className="dcs-managed-browser-surface" ref={surfaceRef} style={surfaceStyle}>
        <canvas
          ref={canvasRef}
          className="dcs-managed-browser-canvas"
          tabIndex={-1}
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
      <textarea
        ref={inputRef}
        className="dcs-managed-ime"
        aria-label="Browser keyboard input"
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

function fitSurface(containerWidth: number, containerHeight: number, viewport: Size): Size {
  const scale = Math.min(containerWidth / Math.max(1, viewport.width), containerHeight / Math.max(1, viewport.height))
  return {
    width: Math.max(1, Math.round(viewport.width * scale)),
    height: Math.max(1, Math.round(viewport.height * scale)),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
