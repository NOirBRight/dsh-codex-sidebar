import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type WheelEvent } from 'react'
import { browserAnnotationHighlightRects, browserAnnotationNodeAt, browserSelectedRectForOutline, browserStreamSignalsReady, browserWebSocketUrl, createBrowserInputCoalescer, decodeBrowserFrame, decodeBrowserOutline, decodeBrowserTrackedRect, updateBrowserSelectedRect, type BrowserOutlineNode } from './managed-browser-stream.ts'
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
  annotate: boolean
  selectedRect: AnnotationRect | null
  selectedSelector: string | null
  requestTicket: (tabId: string) => Promise<StreamTicket | undefined>
  onPick: (rect: AnnotationRect, anchor: Point) => void | Promise<void>
  onState: (projection: ManagedProjection) => void
}

type Point = { x: number; y: number }

export function ManagedBrowserCanvas({ tabId, annotate, selectedRect, selectedSelector, requestTicket, onPick, onState }: ManagedBrowserCanvasProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ticketRef = useRef(requestTicket)
  const stateRef = useRef(onState)
  ticketRef.current = requestTicket
  stateRef.current = onState
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const annotateRef = useRef(annotate)
  const selectedSelectorRef = useRef(selectedSelector)
  const documentRef = useRef<string>()
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout>>()
  annotateRef.current = annotate
  selectedSelectorRef.current = selectedSelector
  const dragRef = useRef<{ point: Point; pointerId: number } | null>(null)
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



  const requestOutline = (delay = 0): void => {
    if (outlineTimerRef.current !== undefined) clearTimeout(outlineTimerRef.current)
    outlineTimerRef.current = undefined
    if (!annotateRef.current) return
    outlineTimerRef.current = setTimeout(() => {
      outlineTimerRef.current = undefined
      send(socketRef.current, { type: 'outline' })
    }, delay)
  }

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
    let resize: ResizeObserver | undefined
    let decoding = false
    let latest: ArrayBuffer | undefined

    const drawLatest = async (): Promise<void> => {
      if (decoding) return
      decoding = true
      try {
        while (!stopped && latest !== undefined) {
          const value = latest
          latest = undefined
          const frame = decodeBrowserFrame(value)
          if (frame.version !== 1) throw new Error('Unsupported Browser stream version')
          const canvas = canvasRef.current
          if (canvas === null) return
          if (canvas.width !== frame.width || canvas.height !== frame.height) {
            canvas.width = frame.width
            canvas.height = frame.height
          }
          const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: 'image/jpeg' }))
          const context = canvas.getContext('bitmaprenderer')
          if (context !== null) context.transferFromImageBitmap(bitmap)
          else canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
          bitmap.close()
        }
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
        if (annotateRef.current) requestOutline()
        const canvas = canvasRef.current
        if (canvas !== null) {
          resize = new ResizeObserver(() => {
            const bounds = canvas.getBoundingClientRect()
            send(socket, { type: 'resize', width: bounds.width, height: bounds.height })
            if (annotateRef.current) {
              setOutlineNodes([])
              setHovered(null)
              requestOutline(180)
            }
          })
          resize.observe(canvas)
        }
      }
      socket.onmessage = (event) => {
        if (browserStreamSignalsReady(event.data)) setStatus('ready')
        if (typeof event.data === 'string') {
          const tracked = decodeBrowserTrackedRect(event.data)
          if (tracked !== undefined) {
            if ((documentRef.current === undefined || documentRef.current === tracked.documentId) && selectedSelectorRef.current === tracked.selector) {
              setSelectedLiveRect((current) => updateBrowserSelectedRect(current, { type: 'tracked', rect: tracked.rect }))
            }
            return
          }
          const outline = decodeBrowserOutline(event.data)
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
            const message = JSON.parse(event.data) as { type?: unknown; projection?: unknown }
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
          } catch { setStatus('error') }
          return
        }
        if (event.data instanceof ArrayBuffer) {
          latest = event.data
          void drawLatest().catch(() => { setStatus('error') })
        }
      }
      socket.onerror = () => { setStatus('error') }
      socket.onclose = () => {
        resize?.disconnect()
        if (socketRef.current === socket) socketRef.current = null
        if (!stopped) reconnect = setTimeout(() => { void connect() }, Math.min(2000, 250 * 2 ** attempt++))
      }
    }

    void connect()
    return () => {
      stopped = true
      if (reconnect !== undefined) clearTimeout(reconnect)
      resize?.disconnect()
      socketRef.current?.close(1000, 'Browser Tab hidden')
      socketRef.current = null
      inputQueueRef.current?.cancel()
    }
  }, [tabId])

  const point = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current
    if (canvas === null) return { x: 0, y: 0 }
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * canvas.width / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) * canvas.height / Math.max(1, bounds.height),
    }
  }

  const input = (value: { type: string; [key: string]: unknown }): void => { inputQueueRef.current?.push(value) }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    inputRef.current?.focus({ preventScroll: true })
    const at = point(event)
    if (annotate) {
      dragRef.current = { point: at, pointerId: event.pointerId }
      setHovered(null)
      setSelection({ x: at.x, y: at.y, w: 0, h: 0 })
      return
    }
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
      void onPick(
        rect.w < 4 && rect.h < 4 ? { x: at.x - 8, y: at.y - 8, w: 16, h: 16 } : rect,
        { x: event.clientX - canvasBounds.left, y: event.clientY - canvasBounds.top },
      )
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

  return (
    <div className="dcs-managed-browser">
      <canvas
        ref={canvasRef}
        className="dcs-managed-browser-canvas"
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setSelection(null); setHovered(null) }}
        onPointerLeave={() => { if (dragRef.current === null) setHovered(null) }}
        onWheel={onWheel}
      />
      {annotate && selection === null && highlights.selected !== null && <div className="dcs-managed-selected" style={selectionStyle(highlights.selected, canvasRef.current)} />}
      {annotate && selection === null && highlights.hovered !== null && <div className="dcs-managed-hover" style={selectionStyle(highlights.hovered, canvasRef.current)} />}
      {annotate && selection !== null && <div className="dcs-managed-selection" style={selectionStyle(selection, canvasRef.current)} />}
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

function selectionStyle(rect: AnnotationRect, canvas: HTMLCanvasElement | null): Record<string, string> {
  if (canvas === null) return {}
  return {
    left: rect.x / Math.max(1, canvas.width) * 100 + '%',
    top: rect.y / Math.max(1, canvas.height) * 100 + '%',
    width: rect.w / Math.max(1, canvas.width) * 100 + '%',
    height: rect.h / Math.max(1, canvas.height) * 100 + '%',
  }
}
